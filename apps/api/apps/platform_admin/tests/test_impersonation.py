"""Impersonation: grants, the handoff exchange and the grant-checking authenticator (§7.3).

Review Focus 2: a released, expired or orphaned grant ends the impersonated session on its next
request, even though the access token's own ``exp`` is still in the future.
"""

from __future__ import annotations

import hashlib
from datetime import timedelta
from unittest import mock
from urllib.parse import parse_qs, urlsplit

from django.conf import settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from apps.platform_admin.models import ImpersonationGrant
from apps.platform_admin.tests.base import (
    TENANTS_URL,
    PlatformAPITestCase,
    make_tenant,
    platform_user,
    tenant_url,
)
from apps.school_organization.models import Campus
from apps.school_organization.tests.factories import grant
from core.audit.models import AuditLog
from core.notifications.models import Notification
from core.rbac import impersonation
from core.rbac.models import Role, User, UserRole
from core.tenancy.context import tenant_context
from core.tenancy.models import TenantStatus

EXCHANGE_URL = "/api/v1/auth/impersonation:exchange"
END_URL = "/api/v1/auth/impersonation:end"
GRANTS_URL = "/api/v1/platform/impersonation-grants"
ME_URL = "/api/v1/auth/me"
REASON = "Ticket 4821: a parent cannot see the fee invoice."


def tenant_user(tenant, email: str = "", **fields) -> User:
    """An active login of ``tenant``."""
    n = User.objects.count()
    return User.objects.create_user(
        email or f"staff{n}@school.test",
        "x-school-pass-1",
        tenant=tenant,
        first_name=fields.pop("first_name", "Bilal"),
        last_name=fields.pop("last_name", "Ahmed"),
        **fields,
    )


def handoff_code(response) -> str:
    """The raw code in the handoff link's fragment."""
    fragment = urlsplit(response.json()["data"]["handoff_url"]).fragment
    return parse_qs(fragment)["code"][0]


class ImpersonationTestCase(PlatformAPITestCase):
    """An active school with one staff login; the operator is a `platform_super_admin`."""

    def setUp(self) -> None:
        super().setUp()
        self.tenant = make_tenant(status=TenantStatus.ACTIVE)
        self.target = tenant_user(self.tenant)

    def start(self, target: User | None = None, *, duration=30, reason=REASON, tenant=None):
        return self.client.post(
            tenant_url(tenant or self.tenant, ":impersonate"),
            {
                "user_id": str((target or self.target).pk),
                "reason": reason,
                "duration_minutes": duration,
            },
            format="json",
        )

    def exchange(self, code: str):
        return APIClient().post(EXCHANGE_URL, {"code": code}, format="json")

    def impersonate(self, target: User | None = None, **kwargs) -> tuple[str, ImpersonationGrant]:
        started = self.start(target, **kwargs)
        self.assertEqual(started.status_code, 201, started.content)
        exchanged = self.exchange(handoff_code(started))
        self.assertEqual(exchanged.status_code, 200, exchanged.content)
        grant_row = ImpersonationGrant.objects.get(pk=started.json()["data"]["grant_id"])
        return exchanged.json()["data"]["access"], grant_row

    @staticmethod
    def as_bearer(access: str) -> APIClient:
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        return client


class GrantTests(ImpersonationTestCase):
    def test_impersonate_returns_the_grant_and_a_handoff_link(self) -> None:
        before = timezone.now()
        response = self.start()

        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()["data"]
        self.assertEqual(set(data), {"grant_id", "expires_at", "handoff_url"})
        url = urlsplit(data["handoff_url"])
        self.assertEqual(url.netloc, f"{self.tenant.slug}.app.schoolhub.test")
        self.assertEqual(url.path, "/impersonate")
        self.assertEqual(parse_qs(url.fragment)["school"], [self.tenant.slug])

        row = ImpersonationGrant.objects.get(pk=data["grant_id"])
        self.assertEqual(row.tenant_id, self.tenant.pk)
        self.assertEqual(row.target_user_id, self.target.pk)
        self.assertEqual(row.granted_to_id, self.operator.pk)
        self.assertEqual(row.reason, REASON)
        self.assertIsNone(row.released_at)
        self.assertAlmostEqual((row.expires_at - before).total_seconds(), 30 * 60, delta=5)

    def test_handoff_code_is_stored_hashed(self) -> None:
        response = self.start()
        code = handoff_code(response)
        row = ImpersonationGrant.objects.get(pk=response.json()["data"]["grant_id"])

        self.assertEqual(row.handoff_code_hash, hashlib.sha256(code.encode()).hexdigest())
        for field in ImpersonationGrant._meta.concrete_fields:
            self.assertNotEqual(str(getattr(row, field.attname)), code, field.name)

    def test_grant_is_audited_and_the_owners_are_told(self) -> None:
        owner = tenant_user(self.tenant, "owner@school.test")
        UserRole.objects.create(user=owner, role=Role.objects.get(tenant=None, slug="school_owner"))
        response = self.start()
        grant_id = response.json()["data"]["grant_id"]

        event = AuditLog.objects.get(action="platform.impersonation.granted")
        self.assertEqual(event.tenant_id, self.tenant.pk)
        self.assertEqual(event.actor_id, self.operator.pk)
        self.assertEqual(event.after["grant_id"], grant_id)
        self.assertEqual(event.after["target_user_id"], str(self.target.pk))
        self.assertEqual(event.after["reason"], REASON)
        with tenant_context(self.tenant.pk):
            notice = Notification.objects.get(event_key="platform.impersonation", user_id=owner.pk)
        self.assertEqual(str(notice.source_id), grant_id)

    def test_new_grant_releases_previous(self) -> None:
        first_access, first = self.impersonate()
        other = tenant_user(self.tenant)
        _, unrelated = self.impersonate(other)

        _, second = self.impersonate()

        first.refresh_from_db()
        unrelated.refresh_from_db()
        self.assertIsNotNone(first.released_at)
        self.assertEqual(first.end_reason, "superseded")
        self.assertIsNone(second.released_at)
        self.assertIsNone(unrelated.released_at, "another target's grant is untouched")
        self.assert_error(self.as_bearer(first_access).get(ME_URL), 401, "impersonation_ended")

    def test_cannot_impersonate_platform_user(self) -> None:
        other_operator = platform_user("platform_support")
        response = self.start(other_operator)

        self.assert_error(response, 422, "domain_rule_violation")
        self.assertFalse(ImpersonationGrant.objects.exists())

    def test_cannot_impersonate_a_user_of_another_school(self) -> None:
        stranger = tenant_user(make_tenant(status=TenantStatus.ACTIVE))
        self.assert_error(self.start(stranger), 422, "domain_rule_violation")
        self.assertFalse(ImpersonationGrant.objects.exists())

    def test_cannot_impersonate_an_inactive_user(self) -> None:
        self.target.is_active = False
        self.target.save(update_fields=["is_active"])
        self.assert_error(self.start(), 422, "domain_rule_violation")

    def test_cannot_impersonate_user_of_suspended_tenant(self) -> None:
        self.tenant.status = TenantStatus.SUSPENDED
        self.tenant.save(update_fields=["status"])

        self.assert_error(self.start(), 409, "conflict")
        self.assertFalse(ImpersonationGrant.objects.exists())

    def test_duration_over_max_is_422(self) -> None:
        maximum = settings.PLATFORM_IMPERSONATION_MAX_MINUTES
        for duration in (maximum + 1, 0):
            with self.subTest(duration=duration):
                self.assert_error(self.start(duration=duration), 422, "domain_rule_violation")
        self.assertEqual(self.start(duration=maximum).status_code, 201)

    def test_reason_is_required(self) -> None:
        self.assert_error(self.start(reason="  "), 400, "validation_error")

    def test_operator_without_the_key_is_403(self) -> None:
        self.sign_in_as(platform_user(role_slug=None))
        self.assert_error(self.start(), 403, "permission_denied")

    def test_tenant_principal_gets_404(self) -> None:
        self.sign_in_as(self.target)
        self.assertEqual(self.start().status_code, 404)


class ExchangeTests(ImpersonationTestCase):
    def test_exchange_issues_a_token_without_refresh_with_the_impersonation_claims(self) -> None:
        started = self.start()
        response = self.exchange(handoff_code(started))

        self.assertEqual(response.status_code, 200, response.content)
        self.assertNotIn("sh_refresh", response.cookies)
        data = response.json()["data"]
        self.assertEqual(set(data), {"access", "expires_in"})
        row = ImpersonationGrant.objects.get(pk=started.json()["data"]["grant_id"])
        token = AccessToken(data["access"])
        self.assertEqual(token["sub"], str(self.target.pk))
        self.assertEqual(token["tenant_id"], str(self.tenant.pk))
        self.assertIs(token["is_platform"], False)
        self.assertEqual(token["act"], {"sub": str(self.operator.pk)})
        self.assertEqual(token["grant_id"], str(row.pk))
        self.assertEqual(token["amr"], ["impersonation"])
        self.assertEqual(token["exp"], int(row.expires_at.timestamp()))
        self.assertLessEqual(data["expires_in"], 30 * 60)
        self.assertGreater(data["expires_in"], 29 * 60)

        row.refresh_from_db()
        self.assertIsNotNone(row.handoff_used_at)
        event = AuditLog.objects.get(action="platform.impersonation.exchanged")
        self.assertEqual(event.tenant_id, self.tenant.pk)

    def test_the_token_cannot_be_refreshed(self) -> None:
        access, _ = self.impersonate()

        with self.assertRaises(TokenError):
            RefreshToken(access)
        client = APIClient()
        client.cookies["sh_refresh"] = access
        self.assertEqual(client.post("/api/v1/auth/refresh").status_code, 401)

    def test_handoff_code_single_use(self) -> None:
        code = handoff_code(self.start())

        self.assertEqual(self.exchange(code).status_code, 200)
        self.assert_error(self.exchange(code), 400, "invalid_link")

    def test_handoff_code_expires_before_grant(self) -> None:
        started = self.start()
        row = ImpersonationGrant.objects.get(pk=started.json()["data"]["grant_id"])
        ttl = settings.PLATFORM_HANDOFF_CODE_TTL_SECONDS
        self.assertLessEqual((row.handoff_expires_at - row.created_at).total_seconds(), ttl + 1)
        self.assertLess(row.handoff_expires_at, row.expires_at)

        ImpersonationGrant.objects.filter(pk=row.pk).update(
            handoff_expires_at=timezone.now() - timedelta(seconds=1)
        )

        self.assert_error(self.exchange(handoff_code(started)), 400, "invalid_link")
        row.refresh_from_db()
        self.assertIsNone(row.released_at, "the grant itself is still live")
        self.assertIsNone(row.handoff_used_at)

    def test_exchange_refused_on_a_released_grant(self) -> None:
        started = self.start()
        self.client.delete(f"{GRANTS_URL}/{started.json()['data']['grant_id']}")

        self.assert_error(self.exchange(handoff_code(started)), 400, "invalid_link")

    def test_exchange_refused_once_the_holder_lost_the_key(self) -> None:
        started = self.start()
        UserRole.objects.get(user=self.operator).delete()

        self.assert_error(self.exchange(handoff_code(started)), 400, "invalid_link")

    def test_an_unknown_code_is_refused_and_audited(self) -> None:
        self.assert_error(self.exchange("not-a-code"), 400, "invalid_link")
        self.assertTrue(
            AuditLog.objects.filter(action="platform.impersonation.exchange_refused").exists()
        )


class AuthenticatorTests(ImpersonationTestCase):
    def test_released_grant_rejects_token_before_exp(self) -> None:
        access, row = self.impersonate()
        client = self.as_bearer(access)
        self.assertEqual(client.get(ME_URL).status_code, 200)

        self.assertEqual(self.client.delete(f"{GRANTS_URL}/{row.pk}").status_code, 204)

        self.assertGreater(AccessToken(access)["exp"], timezone.now().timestamp())
        self.assert_error(client.get(ME_URL), 401, "impersonation_ended")

    def test_holder_losing_key_ends_session(self) -> None:
        access, _ = self.impersonate()
        client = self.as_bearer(access)
        self.assertEqual(client.get(ME_URL).status_code, 200)

        UserRole.objects.get(user=self.operator).delete()

        self.assert_error(client.get(ME_URL), 401, "impersonation_ended")

    def test_holder_deactivated_or_mfa_reset_ends_session(self) -> None:
        for field, value in (("is_active", False), ("mfa_enabled", False)):
            with self.subTest(field=field):
                access, _ = self.impersonate()
                client = self.as_bearer(access)
                self.assertEqual(client.get(ME_URL).status_code, 200)
                User.objects.filter(pk=self.operator.pk).update(**{field: value})

                self.assert_error(client.get(ME_URL), 401, "impersonation_ended")
                User.objects.filter(pk=self.operator.pk).update(is_active=True, mfa_enabled=True)

    def test_expired_grant_rejects_token(self) -> None:
        access, row = self.impersonate()
        ImpersonationGrant.objects.filter(pk=row.pk).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )

        self.assert_error(self.as_bearer(access).get(ME_URL), 401, "impersonation_ended")

    def test_grant_id_without_checker_is_401(self) -> None:
        access, _ = self.impersonate()

        with mock.patch.object(impersonation, "_hooks", None):
            self.assert_error(self.as_bearer(access).get(ME_URL), 401, "impersonation_ended")

    def test_impersonation_amr_without_a_grant_is_401(self) -> None:
        token = AccessToken.for_user(self.target)
        token["amr"] = ["impersonation"]
        token["act"] = {"sub": str(self.operator.pk)}

        self.assert_error(self.as_bearer(str(token)).get(ME_URL), 401, "impersonation_ended")

    def test_a_grant_for_someone_else_is_401(self) -> None:
        access, _ = self.impersonate()
        forged = AccessToken(access)
        forged["sub"] = str(tenant_user(self.tenant).pk)

        self.assert_error(self.as_bearer(str(forged)).get(ME_URL), 401, "impersonation_ended")

    def test_impersonated_token_cannot_reach_platform_routes(self) -> None:
        access, _ = self.impersonate()
        client = self.as_bearer(access)

        self.assertEqual(client.get(TENANTS_URL).status_code, 404)
        self.assertEqual(client.post(tenant_url(self.tenant, ":impersonate"), {}).status_code, 404)

    def test_target_permissions_apply_not_operator(self) -> None:
        grant(self.target, "school.campus.view")
        access, _ = self.impersonate()
        client = self.as_bearer(access)

        me = client.get(ME_URL).json()["data"]
        self.assertEqual(me["id"], str(self.target.pk))
        self.assertEqual(me["permissions"], ["school.campus.view"])
        self.assertIs(me["is_platform"], False)
        self.assertEqual(client.get("/api/v1/campuses").status_code, 200)
        created = client.post("/api/v1/campuses", {"name": "North", "code": "N"}, format="json")
        self.assert_error(created, 403, "permission_denied")

    def test_impersonating_a_restricted_principal_keeps_its_restrictions(self) -> None:
        grant(self.target, "school.campus.view", is_restricted_principal=True)
        access, _ = self.impersonate()

        me = self.as_bearer(access).get(ME_URL).json()["data"]
        self.assertIs(me["is_restricted_principal"], True)

    def test_impersonated_mutation_audit_has_impersonated_by(self) -> None:
        grant(self.target, "school.campus.view", "school.campus.create")
        access, _ = self.impersonate()

        response = self.as_bearer(access).post(
            "/api/v1/campuses", {"name": "North Campus", "code": "north"}, format="json"
        )

        self.assertEqual(response.status_code, 201, response.content)
        with tenant_context(self.tenant.pk):
            campus = Campus.objects.get(code="NORTH")
        row = AuditLog.objects.get(action="create", resource_id=campus.pk)
        self.assertEqual(row.actor_id, self.target.pk)
        self.assertEqual(row.impersonated_by, self.operator.pk)

    def test_me_reports_the_impersonation(self) -> None:
        self.operator.first_name, self.operator.last_name = "Sana", "Iqbal"
        self.operator.save(update_fields=["first_name", "last_name"])
        access, row = self.impersonate()

        me = self.as_bearer(access).get(ME_URL).json()["data"]
        self.assertEqual(me["impersonation"]["by_name"], "Sana Iqbal")
        expires_at = row.expires_at.isoformat().replace("+00:00", "Z")
        self.assertEqual(me["impersonation"]["expires_at"], expires_at)

        own = APIClient()
        own.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(self.target)}")
        self.assertIsNone(own.get(ME_URL).json()["data"]["impersonation"])


class RefusedUnderImpersonationTests(ImpersonationTestCase):
    def test_impersonated_password_change_forbidden(self) -> None:
        access, _ = self.impersonate()

        response = self.as_bearer(access).post(
            "/api/v1/auth/change-password",
            {"current_password": "x-school-pass-1", "new_password": "a-new-pass-123456"},
            format="json",
        )

        self.assert_error(response, 403, "impersonation_forbidden")
        self.target.refresh_from_db()
        self.assertTrue(self.target.check_password("x-school-pass-1"))

    def test_impersonated_mfa_changes_forbidden(self) -> None:
        access, _ = self.impersonate()
        client = self.as_bearer(access)

        for route in ("enroll", "confirm", "disable"):
            with self.subTest(route=route):
                response = client.post(f"/api/v1/auth/mfa:{route}", {"code": "123456"})
                self.assert_error(response, 403, "impersonation_forbidden")


class EndingTests(ImpersonationTestCase):
    def test_logout_releases_grant(self) -> None:
        access, row = self.impersonate()
        client = self.as_bearer(access)
        client.cookies["sh_refresh"] = "the-operator-tab-has-none"

        response = client.post("/api/v1/auth/logout")

        self.assertEqual(response.status_code, 204)
        self.assertNotIn("sh_refresh", response.cookies, "the refresh cookie is left alone")
        row.refresh_from_db()
        self.assertIsNotNone(row.released_at)
        self.assertEqual(row.end_reason, "released")
        self.assertTrue(AuditLog.objects.filter(action="platform.impersonation.released").exists())
        self.assert_error(client.get(ME_URL), 401, "impersonation_ended")

    def test_end_releases_grant(self) -> None:
        access, row = self.impersonate()
        client = self.as_bearer(access)

        self.assertEqual(client.post(END_URL).status_code, 204)

        row.refresh_from_db()
        self.assertEqual(row.end_reason, "released")
        self.assert_error(client.get(ME_URL), 401, "impersonation_ended")

    def test_end_without_an_impersonation_is_404(self) -> None:
        own = APIClient()
        own.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(self.target)}")
        self.assertEqual(own.post(END_URL).status_code, 404)

    def test_the_holder_releases_through_the_console(self) -> None:
        _, row = self.impersonate()

        self.assertEqual(self.client.delete(f"{GRANTS_URL}/{row.pk}").status_code, 204)

        row.refresh_from_db()
        self.assertEqual(row.end_reason, "released")
        self.assertEqual(self.client.delete(f"{GRANTS_URL}/{row.pk}").status_code, 204)

    def test_another_support_operator_cannot_release_it_but_a_super_admin_revokes(self) -> None:
        _, row = self.impersonate()

        self.sign_in_as(platform_user("platform_support"))
        self.assertEqual(self.client.delete(f"{GRANTS_URL}/{row.pk}").status_code, 404)
        row.refresh_from_db()
        self.assertIsNone(row.released_at)

        self.sign_in_as(platform_user("platform_super_admin"))
        self.assertEqual(self.client.delete(f"{GRANTS_URL}/{row.pk}").status_code, 204)
        row.refresh_from_db()
        self.assertEqual(row.end_reason, "revoked")
        self.assertTrue(AuditLog.objects.filter(action="platform.impersonation.revoked").exists())

    def test_expiry_sweep_closes_and_audits(self) -> None:
        from apps.platform_admin.tasks import close_expired_impersonations

        _, row = self.impersonate()
        ended = timezone.now() - timedelta(minutes=1)
        ImpersonationGrant.objects.filter(pk=row.pk).update(expires_at=ended)

        result = close_expired_impersonations()

        self.assertEqual(result["closed"], 1)
        row.refresh_from_db()
        self.assertEqual(row.end_reason, "expired")
        self.assertEqual(row.released_at, row.expires_at)
        event = AuditLog.objects.get(action="platform.impersonation.expired")
        self.assertEqual(event.tenant_id, self.tenant.pk)
        self.assertEqual(close_expired_impersonations()["closed"], 0)


class TenantUsersTests(ImpersonationTestCase):
    def url(self, tenant=None, query: str = "") -> str:
        return f"{TENANTS_URL}/{(tenant or self.tenant).pk}/users{query}"

    def test_lists_the_school_s_active_non_platform_users(self) -> None:
        grant(self.target, "school.campus.view")
        inactive = tenant_user(self.tenant, is_active=False)
        other_school = tenant_user(make_tenant(status=TenantStatus.ACTIVE))

        response = self.client.get(self.url())

        self.assertEqual(response.status_code, 200, response.content)
        rows = response.json()["data"]
        ids = {row["id"] for row in rows}
        self.assertIn(str(self.target.pk), ids)
        self.assertNotIn(str(inactive.pk), ids)
        self.assertNotIn(str(other_school.pk), ids)
        self.assertNotIn(str(self.operator.pk), ids)
        row = next(r for r in rows if r["id"] == str(self.target.pk))
        self.assertEqual(set(row), {"id", "name", "email", "roles"})
        self.assertEqual(row["name"], "Bilal Ahmed")
        self.assertEqual(len(row["roles"]), 1)

    def test_filters_by_query_and_role(self) -> None:
        role = grant(self.target, "school.campus.view")
        other = tenant_user(self.tenant, "zainab@school.test", first_name="Zainab")

        by_name = self.client.get(self.url(query="?q=zain")).json()["data"]
        self.assertEqual([r["id"] for r in by_name], [str(other.pk)])
        by_role = self.client.get(self.url(query=f"?role={role.slug}")).json()["data"]
        self.assertEqual([r["id"] for r in by_role], [str(self.target.pk)])

    def test_needs_the_impersonate_key(self) -> None:
        self.sign_in_as(platform_user(role_slug=None))
        self.assert_error(self.client.get(self.url()), 403, "permission_denied")

    def test_cross_tenant_and_unknown_school_are_404(self) -> None:
        other = make_tenant(status=TenantStatus.ACTIVE)
        self.sign_in_as(tenant_user(other))
        self.assertEqual(self.client.get(self.url()).status_code, 404)

        self.sign_in_as(self.operator)
        missing = f"{TENANTS_URL}/00000000-0000-4000-8000-000000000000/users"
        self.assertEqual(self.client.get(missing).status_code, 404)


class SnapshotTests(ImpersonationTestCase):
    def test_snapshot_counts_impersonations_in_the_last_30_days(self) -> None:
        from apps.platform_admin.usage.services import snapshot_tenant

        _, old = self.impersonate()
        self.impersonate(tenant_user(self.tenant))
        ImpersonationGrant.objects.filter(pk=old.pk).update(
            created_at=timezone.now() - timedelta(days=31)
        )

        with tenant_context(self.tenant.pk):
            snapshot = snapshot_tenant(self.tenant.pk)

        self.assertEqual(snapshot.impersonations_30d, 1)
