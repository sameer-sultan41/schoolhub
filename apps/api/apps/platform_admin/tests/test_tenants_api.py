"""`/api/v1/platform/tenants`: CRUD, `:provision` and the lifecycle actions (§16)."""

from __future__ import annotations

import re
from datetime import timedelta
from pathlib import Path
from unittest import mock

from django.core import mail
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework_simplejwt.tokens import AccessToken

from apps.platform_admin.constants import RESERVED_SLUGS, TENANT_EXPORT_JOB_TYPE
from apps.platform_admin.tests.base import (
    TENANTS_URL,
    PlatformAPITestCase,
    make_tenant,
    platform_user,
    tenant_url,
)
from apps.school_organization.tests.factories import TenantFactory, UserFactory, grant
from core.audit.models import AuditLog
from core.idempotency.models import IdempotencyRecord
from core.jobs.models import BackgroundJob, JobStatus
from core.rbac.invitations.eligibility import is_eligible
from core.rbac.models import Invitation, InvitationKind, User, UserRole
from core.rbac.roles import SCHOOL_OWNER
from core.rbac.tests.link_helpers import emailed_link
from core.tenancy import subscription_state
from core.tenancy.context import tenant_context
from core.tenancy.models import Tenant, TenantSettings, TenantStatus

S = TenantStatus
REPO_ROOT = Path(__file__).resolve().parents[5]
WEBSITE_HOST = REPO_ROOT / "apps/website/src/lib/host.ts"


def create_body(**overrides) -> dict:
    return {
        "name": "Crescent School",
        "slug": "crescent",
        "contact_name": "Amina Khan",
        "contact_email": "amina@crescent.test",
        "contact_phone": "+923001234567",
        **overrides,
    }


def field_errors(response) -> set[str]:
    return {detail["field"] for detail in response.json()["error"]["details"]}


class TenantCreateTests(PlatformAPITestCase):
    def test_create_makes_a_provisioning_tenant(self) -> None:
        response = self.client.post(TENANTS_URL, create_body(), format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        data = response.json()["data"]
        self.assertEqual(data["status"], S.PROVISIONING)
        tenant = Tenant.objects.get(pk=data["id"])
        self.assertEqual(
            (tenant.slug, tenant.contact_name, tenant.contact_email, tenant.contact_phone),
            ("crescent", "Amina Khan", "amina@crescent.test", "+923001234567"),
        )
        self.assertEqual(tenant.created_by, self.operator.pk)
        row = AuditLog.objects.get(action="create", resource_id=tenant.pk)
        self.assertEqual(row.actor_id, self.operator.pk)

    def test_create_refuses_reserved_slug(self) -> None:
        for slug in ("admin", "www", "app", "api"):
            with self.subTest(slug=slug):
                response = self.client.post(TENANTS_URL, create_body(slug=slug), format="json")
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
                self.assertEqual(field_errors(response), {"slug"})
        self.assertFalse(Tenant.objects.filter(slug__in=RESERVED_SLUGS).exists())

    def test_create_refuses_a_slug_that_is_not_a_dns_label(self) -> None:
        for slug in ("Crescent", "-crescent", "crescent-", "under_score", "ab", "a" * 64):
            with self.subTest(slug=slug):
                response = self.client.post(TENANTS_URL, create_body(slug=slug), format="json")
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
                self.assertEqual(field_errors(response), {"slug"})

    def test_create_refuses_a_taken_slug(self) -> None:
        make_tenant(slug="crescent")

        response = self.client.post(TENANTS_URL, create_body(), format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(field_errors(response), {"slug"})

    def test_reserved_labels_match_website(self) -> None:
        source = WEBSITE_HOST.read_text(encoding="utf-8")
        block = re.search(r"RESERVED_LABELS = new Set\(\[(.*?)\]\)", source, re.DOTALL)
        assert block is not None, f"RESERVED_LABELS not found in {WEBSITE_HOST}"
        website = set(re.findall(r'"([^"]+)"', block.group(1)))

        self.assertEqual(set(RESERVED_SLUGS), website)


class TenantReadTests(PlatformAPITestCase):
    def test_list_filters_by_status_and_search(self) -> None:
        trial = make_tenant(status=S.TRIAL, name="Oak Academy")
        make_tenant(status=S.ACTIVE, name="Pine School")

        by_status = self.client.get(TENANTS_URL, {"status": S.TRIAL})
        by_search = self.client.get(TENANTS_URL, {"search": "oak"})

        self.assertEqual(by_status.status_code, status.HTTP_200_OK, by_status.content)
        self.assertEqual([row["id"] for row in by_status.json()["data"]], [str(trial.pk)])
        self.assertEqual([row["id"] for row in by_search.json()["data"]], [str(trial.pk)])

    def test_detail_returns_the_lifecycle_columns(self) -> None:
        tenant = make_tenant(status=S.ACTIVE, current_plan="standard", subscription_status="active")

        response = self.client.get(tenant_url(tenant))

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        data = response.json()["data"]
        for field in (
            "status",
            "contact_email",
            "trial_ends_at",
            "provisioned_at",
            "suspended_at",
            "deprovision_after",
            "current_plan",
            "subscription_status",
        ):
            self.assertIn(field, data)
        self.assertEqual(data["current_plan"], "standard")

    def test_unknown_tenant_is_404(self) -> None:
        response = self.client.get(f"{TENANTS_URL}/00000000-0000-0000-0000-000000000000")

        self.assert_error(response, status.HTTP_404_NOT_FOUND, "not_found")

    def test_tenant_principal_gets_404_on_tenant_routes(self) -> None:
        school = TenantFactory()
        user = UserFactory(tenant=school)
        grant(user, "platform.job.view")
        token = AccessToken.for_user(user)
        token["amr"] = ["pwd", "otp"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

        self.assert_error(self.client.get(TENANTS_URL), status.HTTP_404_NOT_FOUND, "not_found")
        self.assert_error(
            self.client.get(tenant_url(school)), status.HTTP_404_NOT_FOUND, "not_found"
        )
        self.assert_error(
            self.client.post(tenant_url(school, ":suspend"), {"reason": "x"}, format="json"),
            status.HTTP_404_NOT_FOUND,
            "not_found",
        )

    def test_platform_support_reads_but_cannot_provision_or_suspend(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)
        self.sign_in_as(platform_user("platform_support"))

        self.assertEqual(self.client.get(TENANTS_URL).status_code, status.HTTP_200_OK)
        self.assert_error(
            self.client.post(TENANTS_URL, create_body(), format="json"),
            status.HTTP_403_FORBIDDEN,
            "permission_denied",
        )
        self.assert_error(
            self.client.post(tenant_url(tenant, ":suspend"), {"reason": "x"}, format="json"),
            status.HTTP_403_FORBIDDEN,
            "permission_denied",
        )


class TenantUpdateTests(PlatformAPITestCase):
    def test_contact_details_are_editable(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)

        response = self.client.patch(
            tenant_url(tenant), {"contact_phone": "+923009999999"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        tenant.refresh_from_db()
        self.assertEqual(tenant.contact_phone, "+923009999999")
        self.assertTrue(AuditLog.objects.filter(action="update", resource_id=tenant.pk).exists())

    def test_slug_immutable_after_provision(self) -> None:
        tenant = make_tenant()
        renamed = self.client.patch(tenant_url(tenant), {"slug": "renamed"}, format="json")
        self.assertEqual(renamed.status_code, status.HTTP_200_OK, renamed.content)

        self.client.post(tenant_url(tenant, ":provision"), {}, format="json")
        response = self.client.patch(tenant_url(tenant), {"slug": "renamed-again"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(field_errors(response), {"slug"})
        tenant.refresh_from_db()
        self.assertEqual(tenant.slug, "renamed")


class ProvisionTests(PlatformAPITestCase):
    def provision(self, tenant, **kwargs):
        return self.client.post(tenant_url(tenant, ":provision"), {}, format="json", **kwargs)

    def seeded(self, tenant) -> tuple[int, int, int]:
        with tenant_context(tenant.pk):
            return (
                TenantSettings.objects.count(),
                User.objects.filter(tenant=tenant).count(),
                Invitation.objects.count(),
            )

    @override_settings(PLATFORM_DEFAULT_TRIAL_DAYS=14)
    def test_provision_seeds_settings_owner_invitation_once(self) -> None:
        tenant = make_tenant(contact_name="Amina Bibi Khan")
        before = timezone.now()

        response = self.provision(tenant)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertEqual(response.json()["data"]["status"], S.TRIAL)
        self.assertEqual(self.seeded(tenant), (1, 1, 1))
        tenant.refresh_from_db()
        self.assertEqual(tenant.status, S.TRIAL)
        self.assertGreaterEqual(tenant.provisioned_at, before)
        self.assertGreaterEqual(tenant.trial_ends_at, before + timedelta(days=14))
        self.assertLessEqual(tenant.trial_ends_at, timezone.now() + timedelta(days=14))

        owner = User.objects.get(tenant=tenant)
        # A7: the first space splits the name; the rest is the last name.
        self.assertEqual((owner.first_name, owner.last_name), ("Amina", "Bibi Khan"))
        self.assertEqual(owner.email, tenant.contact_email)
        self.assertFalse(owner.is_active)
        self.assertFalse(owner.has_usable_password())
        role = UserRole.objects.select_related("role").get(user=owner).role
        self.assertEqual((role.slug, role.tenant_id), (SCHOOL_OWNER, None))
        with tenant_context(tenant.pk):
            self.assertEqual(Invitation.objects.get().kind, InvitationKind.OWNER)
        row = AuditLog.objects.get(action="provision", resource_id=tenant.pk)
        self.assertEqual((row.actor_id, row.tenant_id), (self.operator.pk, tenant.pk))

    def test_a_single_word_contact_name_has_an_empty_last_name(self) -> None:
        tenant = make_tenant(contact_name="Amina")

        self.provision(tenant)

        owner = User.objects.get(tenant=tenant)
        self.assertEqual((owner.first_name, owner.last_name), ("Amina", ""))

    def test_provision_replays_under_same_key(self) -> None:
        tenant = make_tenant()

        first = self.provision(tenant, HTTP_IDEMPOTENCY_KEY="provision-1")
        second = self.provision(tenant, HTTP_IDEMPOTENCY_KEY="provision-1")

        self.assertEqual(first.status_code, status.HTTP_200_OK, first.content)
        self.assertEqual(second.status_code, first.status_code)
        self.assertEqual(second.json(), first.json())
        self.assertEqual(self.seeded(tenant), (1, 1, 1))
        with tenant_context(tenant.pk):
            self.assertTrue(IdempotencyRecord.objects.filter(key="provision-1").exists())

    def test_second_provision_is_409(self) -> None:
        tenant = make_tenant()
        self.assertEqual(self.provision(tenant).status_code, status.HTTP_200_OK)

        response = self.provision(tenant)

        self.assert_error(response, status.HTTP_409_CONFLICT, "invalid_transition")
        self.assertEqual(self.seeded(tenant), (1, 1, 1))

    def test_provision_refuses_a_plan_until_plans_exist(self) -> None:
        tenant = make_tenant()

        response = self.client.post(
            tenant_url(tenant, ":provision"), {"plan_code": "standard"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        tenant.refresh_from_db()
        self.assertEqual(tenant.status, S.PROVISIONING)
        self.assertEqual(self.seeded(tenant), (0, 0, 0))

    def test_owner_invite_link_on_tenant_host(self) -> None:
        tenant = make_tenant(slug="crescent")

        with self.captureOnCommitCallbacks(execute=True):
            self.provision(tenant)

        message = mail.outbox[-1]
        self.assertEqual(message.to, [tenant.contact_email])
        link, fragment = emailed_link(message)
        self.assertTrue(link.startswith("https://crescent.app.schoolhub.test/accept-invite#"))
        self.assertEqual(fragment["school"], "crescent")

    def test_owner_invitation_is_eligible_only_while_the_owner_holds_the_role(self) -> None:
        tenant = make_tenant()
        self.provision(tenant)
        owner = User.objects.get(tenant=tenant)

        self.assertTrue(is_eligible(owner, InvitationKind.OWNER))
        UserRole.objects.filter(user=owner).delete()
        self.assertFalse(is_eligible(owner, InvitationKind.OWNER))


class LifecycleActionTests(PlatformAPITestCase):
    def act(self, tenant, action: str, body: dict | None = None):
        return self.client.post(tenant_url(tenant, f":{action}"), body or {}, format="json")

    def test_suspend_audit_has_actor_and_tenant(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)

        response = self.act(tenant, "suspend", {"reason": "Terms of service"})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertEqual(response.json()["data"]["status"], S.SUSPENDED)
        row = AuditLog.objects.get(action="suspend", resource_id=tenant.pk)
        self.assertEqual((row.actor_id, row.tenant_id), (self.operator.pk, tenant.pk))
        self.assertEqual(row.before["status"], S.ACTIVE)
        self.assertEqual(row.after["status"], S.SUSPENDED)
        self.assertEqual(row.after["reason"], "Terms of service")

    def test_suspend_delete_and_restore_require_a_reason(self) -> None:
        for action, source in (
            ("suspend", S.ACTIVE),
            ("delete", S.ACTIVE),
            ("restore", S.DEPROVISIONED),
        ):
            with self.subTest(action=action):
                tenant = make_tenant(
                    status=source, deprovision_after=timezone.now() + timedelta(days=1)
                )
                response = self.act(tenant, action, {"reason": "  ", "waive_export": True})
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
                self.assertEqual(field_errors(response), {"reason"})

    def test_an_edge_outside_the_table_is_409(self) -> None:
        tenant = make_tenant()

        response = self.act(tenant, "suspend", {"reason": "too early"})

        self.assert_error(response, status.HTTP_409_CONFLICT, "invalid_transition")

    def test_reinstate_without_live_subscription_is_409(self) -> None:
        tenant = make_tenant(status=S.SUSPENDED)

        response = self.act(tenant, "reinstate")

        self.assert_error(response, status.HTTP_409_CONFLICT, "no_live_subscription")
        tenant.refresh_from_db()
        self.assertEqual(tenant.status, S.SUSPENDED)

    def test_reinstate_trial_requires_future_trial_end(self) -> None:
        tenant = make_tenant(status=S.SUSPENDED)

        past = self.act(tenant, "reinstate", {"trial_ends_at": timezone.now() - timedelta(days=1)})
        self.assertEqual(past.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(field_errors(past), {"trial_ends_at"})

        # Whole seconds: the JSON encoder drops sub-millisecond precision.
        trial_end = (timezone.now() + timedelta(days=7)).replace(microsecond=0)
        response = self.act(tenant, "reinstate", {"trial_ends_at": trial_end})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        tenant.refresh_from_db()
        self.assertEqual(tenant.status, S.TRIAL)
        self.assertEqual(tenant.trial_ends_at, trial_end)
        self.assertIsNone(tenant.suspended_at)
        self.assertTrue(AuditLog.objects.filter(action="reinstate", resource_id=tenant.pk).exists())

    def test_reinstate_follows_the_registered_subscription_state(self) -> None:
        for state, expected in (("active", S.ACTIVE), ("past_due", S.PAST_DUE)):
            with (
                self.subTest(state=state),
                mock.patch.object(subscription_state, "_resolver", lambda _tenant, s=state: s),
            ):
                tenant = make_tenant(status=S.SUSPENDED)
                response = self.act(tenant, "reinstate")
                self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
                self.assertEqual(response.json()["data"]["status"], expected)

    def test_a_trialing_subscription_still_needs_a_trial_end(self) -> None:
        tenant = make_tenant(status=S.SUSPENDED)

        with mock.patch.object(subscription_state, "_resolver", lambda _tenant: "trialing"):
            response = self.act(tenant, "reinstate")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(field_errors(response), {"trial_ends_at"})

    def test_delete_without_export_or_waiver_is_409(self) -> None:
        for source in (S.ACTIVE, S.SUSPENDED):
            with self.subTest(source=source):
                tenant = make_tenant(status=source)
                response = self.act(tenant, "delete", {"reason": "closing"})
                self.assert_error(response, status.HTTP_409_CONFLICT, "export_required")
                tenant.refresh_from_db()
                self.assertEqual(tenant.status, source)

    def test_delete_with_a_waiver_or_a_succeeded_export(self) -> None:
        waived = make_tenant(status=S.ACTIVE)
        response = self.act(waived, "delete", {"reason": "closing", "waive_export": True})
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertEqual(response.json()["data"]["status"], S.DEPROVISIONED)

        exported = make_tenant(status=S.SUSPENDED)
        with tenant_context(exported.pk):
            BackgroundJob.objects.create(
                tenant=exported, job_type=TENANT_EXPORT_JOB_TYPE, status=JobStatus.SUCCEEDED
            )
        response = self.act(exported, "delete", {"reason": "closing"})
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        exported.refresh_from_db()
        self.assertEqual(exported.status, S.DEPROVISIONED)
        self.assertIsNotNone(exported.deprovision_after)

    def test_a_failed_export_does_not_unblock_delete(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)
        with tenant_context(tenant.pk):
            BackgroundJob.objects.create(
                tenant=tenant, job_type=TENANT_EXPORT_JOB_TYPE, status=JobStatus.FAILED
            )

        response = self.act(tenant, "delete", {"reason": "closing"})

        self.assert_error(response, status.HTTP_409_CONFLICT, "export_required")

    def test_provisioning_tenant_delete_needs_no_export(self) -> None:
        tenant = make_tenant()

        response = self.act(tenant, "delete", {"reason": "created by mistake"})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        tenant.refresh_from_db()
        self.assertEqual(tenant.status, S.DEPROVISIONED)

    def test_restore_inside_and_outside_the_retention_window(self) -> None:
        live = make_tenant(
            status=S.DEPROVISIONED, deprovision_after=timezone.now() + timedelta(days=3)
        )
        response = self.act(live, "restore", {"reason": "school came back"})
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertEqual(response.json()["data"]["status"], S.SUSPENDED)

        expired = make_tenant(
            status=S.DEPROVISIONED, deprovision_after=timezone.now() - timedelta(seconds=1)
        )
        response = self.act(expired, "restore", {"reason": "too late"})
        self.assert_error(response, status.HTTP_409_CONFLICT, "retention_expired")
