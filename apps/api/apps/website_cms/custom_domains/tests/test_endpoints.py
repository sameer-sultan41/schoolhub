"""Endpoint tests for `/custom-domains`: claim, verify, primary, delete and permissions."""

from __future__ import annotations

from datetime import timedelta
from unittest import mock

from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.school_organization.tests.factories import grant_default_role
from apps.website_cms.constants import MAX_CUSTOM_DOMAINS
from apps.website_cms.custom_domains.adapters import DnsCheck
from apps.website_cms.custom_domains.services import DOMAIN_TAKEN_REASON
from apps.website_cms.hosts import resolve_host
from apps.website_cms.models import CustomDomain, CustomDomainRoute, CustomDomainStatus
from apps.website_cms.notifications import DOMAIN_ACTIVE
from apps.website_cms.revalidation import host_tag
from apps.website_cms.tests.base import WebsiteAPITestCase
from apps.website_cms.tests.factories import (
    UserFactory,
    authenticate,
    grant,
    make_custom_domain,
)
from apps.website_cms.urls_builder import platform_site_host, tenant_site_host
from core.api.tests.rollback import rollback_as_in_production
from core.notifications.models import Notification
from core.tenancy.context import tenant_context

LIST = "/api/v1/custom-domains"
DOMAIN_KEYS = (
    "website.custom-domain.create",
    "website.custom-domain.update",
    "website.custom-domain.delete",
)
CNAME_TARGET = "sites.schoolhub.test"
SERVICES = "apps.website_cms.custom_domains.services"


def detail(row: CustomDomain) -> str:
    return f"{LIST}/{row.id}"


def verify_url(row: CustomDomain) -> str:
    return f"{LIST}/{row.id}:verify"


def reason(response) -> str:
    return response.json()["error"]["meta"]["reason"]


def jwt_only_client(user) -> APIClient:
    """The bearer token alone, as a real client sends it: no `force_login` session (L63)."""
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")
    return client


class StubVerifier:
    """A verifier whose `check` runs `during` (a concurrent user or school) before answering."""

    def __init__(self, result: DnsCheck, during=None) -> None:
        self.result = result
        self.during = during
        self.calls: list[str] = []

    def check(self, domain: str, token: str, cname_target: str) -> DnsCheck:
        self.calls.append(domain)
        if self.during is not None:
            self.during()
        return self.result


class DomainTestCase(WebsiteAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        # `:verify` is `non_atomic_requests`; its error responses need production's rollback.
        rollback_as_in_production(self)
        self.allow(*DOMAIN_KEYS)
        self.it_admin = UserFactory(tenant=self.tenant)
        grant_default_role(self.it_admin, "it_admin")

    def claim(
        self,
        domain: str,
        status: str = CustomDomainStatus.PENDING_DNS,
        *,
        tenant=None,
        is_primary: bool = False,
    ) -> CustomDomain:
        return make_custom_domain(tenant or self.tenant, domain, status, is_primary=is_primary)

    def stored(self, row: CustomDomain) -> CustomDomain:
        """The row as stored, soft-deleted or not."""
        with tenant_context(row.tenant_id):
            return CustomDomain.all_tenants.get(pk=row.pk)

    def notifications(self, event_key: str, row: CustomDomain) -> list[Notification]:
        with tenant_context(row.tenant_id):
            return list(Notification.objects.filter(event_key=event_key, source_id=row.pk))

    def stub(self, verifier: StubVerifier):
        return mock.patch(f"{SERVICES}.get_dns_verifier", return_value=verifier)


@override_settings(WEBSITE_CNAME_TARGET=CNAME_TARGET)
class CreateDomainTests(DomainTestCase):
    def test_create_returns_dns_instructions(self) -> None:
        response = self.client.post(LIST, {"domain": " WWW.Greenfield.Test. "}, format="json")
        self.assertEqual(response.status_code, 201)
        data = response.json()["data"]
        self.assertEqual(data["domain"], "www.greenfield.test")
        self.assertEqual(data["status"], CustomDomainStatus.PENDING_DNS)
        self.assertEqual(data["tls_status"], "pending")
        self.assertFalse(data["is_primary"])
        with tenant_context(self.tenant.id):
            row = CustomDomain.objects.get(pk=data["id"])
        self.assertGreaterEqual(len(row.verification_token), 32)
        self.assertEqual(
            data["dns_records"],
            [
                {
                    "type": "TXT",
                    "name": "_schoolhub-verify.www.greenfield.test",
                    "value": row.verification_token,
                    "keep_after_verification": False,
                },
                {
                    "type": "CNAME",
                    "name": "www.greenfield.test",
                    "value": CNAME_TARGET,
                    "keep_after_verification": True,
                },
            ],
        )

    def test_list_shows_the_instructions_too(self) -> None:
        self.claim("www.greenfield.test")
        rows = self.client.get(LIST).json()["data"]
        self.assertEqual([r["domain"] for r in rows], ["www.greenfield.test"])
        self.assertEqual(rows[0]["dns_records"][1]["value"], CNAME_TARGET)

    def test_internationalised_domain_is_stored_as_its_a_label(self) -> None:
        # UTS #46 non-transitional (IDNA 2008), as browsers send it: ß is kept, not mapped to ss.
        for raw, stored in (
            ("Bücher.example", "xn--bcher-kva.example"),
            ("straße.example", "xn--strae-oqa.example"),
        ):
            with self.subTest(raw=raw):
                response = self.client.post(LIST, {"domain": raw}, format="json")
                self.assertEqual(response.status_code, 201, response.content)
                self.assertEqual(response.json()["data"]["domain"], stored)

    def test_invalid_fqdn_422(self) -> None:
        for raw in (
            "",
            "localhost",
            "https://example.org",
            "example.org/admissions",
            "example.org:8080",
            "admin@example.org",
            "my school.org",
            "-bad.example.org",
            "bad-.example.org",
            "example..org",
            "under_score.example.org",
            "1.2.3.4",
            f"{'a' * 64}.example.org",
            ".".join(["abcdefghi"] * 26),  # 259 characters
        ):
            with self.subTest(raw=raw):
                response = self.client.post(LIST, {"domain": raw}, format="json")
                # An empty string fails the serializer's shape check; every name, the service.
                self.assertIn(response.status_code, (400, 422) if raw == "" else (422,))
                if raw:
                    self.assertEqual(reason(response), "invalid_domain")
        with tenant_context(self.tenant.id):
            self.assertFalse(CustomDomain.objects.exists())

    @override_settings(PLATFORM_DOMAIN="SchoolHub.pk")
    def test_platform_subdomain_rejected(self) -> None:
        for raw in ("schoolhub.pk", "greenfield.schoolhub.pk", "www.greenfield.SCHOOLHUB.pk"):
            with self.subTest(raw=raw):
                response = self.client.post(LIST, {"domain": raw}, format="json")
                self.assertEqual(response.status_code, 422)
                self.assertEqual(reason(response), "platform_domain")
        # A name that merely ends in the same letters is someone else's domain.
        self.assertEqual(
            self.client.post(LIST, {"domain": "myschoolhub.pk"}, format="json").status_code, 201
        )

    def test_same_domain_twice_is_422(self) -> None:
        self.claim("www.greenfield.test")
        response = self.client.post(LIST, {"domain": "WWW.greenfield.test"}, format="json")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(reason(response), "duplicate_domain")

    def test_another_school_may_claim_the_same_name(self) -> None:
        # A claim proves nothing until DNS does (plan alternative 8).
        self.claim("shared.test", CustomDomainStatus.ACTIVE, tenant=self.make_other_tenant())
        response = self.client.post(LIST, {"domain": "shared.test"}, format="json")
        self.assertEqual(response.status_code, 201)

    def test_limit_of_five(self) -> None:
        for n in range(MAX_CUSTOM_DOMAINS):
            response = self.client.post(LIST, {"domain": f"site{n}.test"}, format="json")
            self.assertEqual(response.status_code, 201)
        response = self.client.post(LIST, {"domain": "one-too-many.test"}, format="json")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(reason(response), "domain_limit")
        # Removing one frees a place; deleted rows do not count.
        with tenant_context(self.tenant.id):
            first = CustomDomain.objects.get(domain="site0.test")
        self.assertEqual(self.client.delete(detail(first)).status_code, 204)
        response = self.client.post(LIST, {"domain": "one-too-many.test"}, format="json")
        self.assertEqual(response.status_code, 201)


@override_settings(WEBSITE_CNAME_TARGET=CNAME_TARGET)
class VerifyDomainTests(DomainTestCase):
    def test_verify_success_writes_route_and_notifies(self) -> None:
        row = self.claim("www.greenfield.test")
        with mock.patch(f"{SERVICES}.queue_revalidation") as revalidate:
            response = self.client.post(verify_url(row))
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()["data"]
        self.assertEqual(data["status"], CustomDomainStatus.ACTIVE)
        self.assertIsNotNone(data["verified_at"])
        self.assertEqual(data["last_error"], "")
        route = CustomDomainRoute.objects.get(domain="www.greenfield.test")
        self.assertEqual((route.tenant_id, route.custom_domain_id), (self.tenant.id, row.id))
        self.assertEqual(resolve_host("www.greenfield.test"), self.tenant)
        sent = self.notifications(DOMAIN_ACTIVE, row)
        self.assertEqual({n.user_id for n in sent}, {self.it_admin.pk})
        self.assertEqual(sent[0].title, "www.greenfield.test is now live")
        tags = set(revalidate.call_args.args[1])
        self.assertIn(host_tag("www.greenfield.test"), tags)
        self.assertIn(host_tag(platform_site_host(self.tenant)), tags)

    def test_verify_failure_sets_failed(self) -> None:
        row = self.claim("www.greenfield.example")
        response = self.client.post(verify_url(row))
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["status"], CustomDomainStatus.FAILED)
        self.assertIn("_schoolhub-verify.www.greenfield.example", data["last_error"])
        self.assertFalse(CustomDomainRoute.objects.filter(custom_domain_id=row.id).exists())
        # A first failure is not yet a day old: no failure notification.
        self.assertEqual(self.notifications("website.domain-failed", row), [])

    def test_a_failed_domain_can_be_verified_again(self) -> None:
        row = self.claim("www.greenfield.test", CustomDomainStatus.FAILED)
        response = self.client.post(verify_url(row))
        self.assertEqual(response.json()["data"]["status"], CustomDomainStatus.ACTIVE)

    def test_verifying_an_active_domain_changes_nothing(self) -> None:
        row = self.claim("www.greenfield.test", CustomDomainStatus.ACTIVE)
        verifier = StubVerifier(DnsCheck(False, "unused"))
        with self.stub(verifier):
            response = self.client.post(verify_url(row))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["status"], CustomDomainStatus.ACTIVE)
        self.assertEqual(verifier.calls, [])

    def test_a_disabled_domain_cannot_be_verified(self) -> None:
        row = self.claim("www.greenfield.test", CustomDomainStatus.DISABLED)
        response = self.client.post(verify_url(row))
        self.assertEqual(response.status_code, 422)
        self.assertEqual(reason(response), "not_verifiable")

    def test_second_tenant_cannot_activate_taken_domain_409(self) -> None:
        other = self.make_other_tenant()
        theirs = self.claim("shared.test", CustomDomainStatus.ACTIVE, tenant=other)
        mine = self.claim("shared.test")
        response = self.client.post(verify_url(mine))
        self.assertEqual(response.status_code, 409)
        self.assertTrue(response.json()["error"]["details"][0]["issue"].startswith("domain_taken"))
        stored = self.stored(mine)
        self.assertEqual(stored.status, CustomDomainStatus.FAILED)
        self.assertEqual(stored.last_error, DOMAIN_TAKEN_REASON)
        route = CustomDomainRoute.objects.get(domain="shared.test")
        self.assertEqual((route.tenant_id, route.custom_domain_id), (other.id, theirs.id))

    def test_taken_domain_notifies_failure_once_and_never_looks_verified(self) -> None:
        # The activation rolls back with the route insert, so the claim keeps
        # `failure_notified_at` and a second attempt does not notify again.
        self.claim("shared.test", CustomDomainStatus.ACTIVE, tenant=self.make_other_tenant())
        mine = self.claim("shared.test")
        with tenant_context(self.tenant.id):
            CustomDomain.objects.filter(pk=mine.pk).update(
                created_at=timezone.now() - timedelta(hours=25)
            )
        for _ in range(2):
            self.assertEqual(self.client.post(verify_url(mine)).status_code, 409)
        self.assertEqual(len(self.notifications("website.domain-failed", mine)), 1)
        stored = self.stored(mine)
        self.assertIsNone(stored.verified_at)
        self.assertEqual(stored.status, CustomDomainStatus.FAILED)
        self.assertEqual(stored.last_error, DOMAIN_TAKEN_REASON)

    def test_concurrent_activation_second_gets_409_not_500(self) -> None:
        # The other school activates between this check's read and its write: nothing was
        # checked before the insert, so the unique route index decides (no check-then-write).
        other = self.make_other_tenant()
        mine = self.claim("race.test")

        def other_school_activates() -> None:
            self.claim("race.test", CustomDomainStatus.ACTIVE, tenant=other)

        with self.stub(StubVerifier(DnsCheck(True), during=other_school_activates)):
            response = self.client.post(verify_url(mine))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.stored(mine).status, CustomDomainStatus.FAILED)
        self.assertEqual(CustomDomainRoute.objects.get(domain="race.test").tenant_id, other.id)

    def test_result_discarded_when_domain_deleted_mid_verify(self) -> None:
        row = self.claim("www.greenfield.test")

        def user_deletes() -> None:
            with tenant_context(self.tenant.id):
                CustomDomain.objects.filter(pk=row.pk).update(deleted_at=row.created_at)

        with self.stub(StubVerifier(DnsCheck(True), during=user_deletes)):
            response = self.client.post(verify_url(row))
        self.assertEqual(response.status_code, 404)
        self.assertNotEqual(self.stored(row).status, CustomDomainStatus.ACTIVE)
        self.assertFalse(CustomDomainRoute.objects.filter(domain="www.greenfield.test").exists())

    def test_long_domain_notification_fits_the_title(self) -> None:
        long_domain = ".".join(["a" * 63, "b" * 63, "c" * 63, "d" * 40, "test"])
        row = self.claim(long_domain)
        self.assertEqual(self.client.post(verify_url(row)).status_code, 200)
        title = self.notifications(DOMAIN_ACTIVE, row)[0].title
        self.assertLessEqual(len(title), 200)
        self.assertTrue(title.endswith("is now live"))


class PrimaryAndDeleteTests(DomainTestCase):
    def test_primary_requires_active(self) -> None:
        for status in (
            CustomDomainStatus.PENDING_DNS,
            CustomDomainStatus.VERIFYING,
            CustomDomainStatus.FAILED,
            CustomDomainStatus.DISABLED,
        ):
            with self.subTest(status=status):
                row = self.claim(f"{status}.test", status)
                response = self.client.patch(detail(row), {"is_primary": True}, format="json")
                self.assertEqual(response.status_code, 422)
                self.assertEqual(reason(response), "not_active")

    def test_making_one_primary_clears_the_other(self) -> None:
        first = self.claim("one.test", CustomDomainStatus.ACTIVE, is_primary=True)
        second = self.claim("two.test", CustomDomainStatus.ACTIVE)
        with mock.patch(f"{SERVICES}.queue_revalidation") as revalidate:
            response = self.client.patch(detail(second), {"is_primary": True}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["data"]["is_primary"])
        self.assertFalse(self.stored(first).is_primary)
        self.assertEqual(tenant_site_host(self.tenant), "two.test")
        revalidate.assert_called_once()
        response = self.client.patch(detail(second), {"is_primary": False}, format="json")
        self.assertFalse(response.json()["data"]["is_primary"])
        self.assertEqual(tenant_site_host(self.tenant), platform_site_host(self.tenant))

    def test_patch_needs_is_primary(self) -> None:
        row = self.claim("one.test", CustomDomainStatus.ACTIVE)
        self.assertEqual(self.client.patch(detail(row), {}, format="json").status_code, 400)

    def test_delete_removes_route(self) -> None:
        row = self.claim("www.greenfield.test", CustomDomainStatus.ACTIVE, is_primary=True)
        with mock.patch(f"{SERVICES}.queue_revalidation") as revalidate:
            self.assertEqual(self.client.delete(detail(row)).status_code, 204)
        stored = self.stored(row)
        self.assertIsNotNone(stored.deleted_at)
        self.assertFalse(stored.is_primary)
        self.assertFalse(CustomDomainRoute.objects.filter(custom_domain_id=row.id).exists())
        self.assertIsNone(resolve_host("www.greenfield.test"))
        # The next primary falls back to the subdomain.
        self.assertEqual(tenant_site_host(self.tenant), platform_site_host(self.tenant))
        self.assertIn(host_tag("www.greenfield.test"), revalidate.call_args.args[1])
        self.assertEqual(self.client.get(LIST).json()["data"], [])

    def test_tenant_deleting_pending_claim_of_other_tenants_active_domain_leaves_route(
        self,
    ) -> None:
        other = self.make_other_tenant()
        theirs = self.claim("shared.test", CustomDomainStatus.ACTIVE, tenant=other)
        mine = self.claim("shared.test")
        self.assertEqual(self.client.delete(detail(mine)).status_code, 204)
        route = CustomDomainRoute.objects.get(domain="shared.test")
        self.assertEqual((route.tenant_id, route.custom_domain_id), (other.id, theirs.id))
        self.assertEqual(resolve_host("shared.test"), other)


class DomainPermissionTests(DomainTestCase):
    def sign_in_with(self, *keys: str):
        user = UserFactory(tenant=self.tenant)
        grant(user, *keys)
        authenticate(self.client, user)
        return user

    def test_list_needs_create_or_update(self) -> None:
        self.claim("one.test")
        self.sign_in_with("website.page.view")
        self.assertEqual(self.client.get(LIST).status_code, 403)
        for key in ("website.custom-domain.create", "website.custom-domain.update"):
            with self.subTest(key=key):
                self.sign_in_with(key)
                self.assertEqual(self.client.get(LIST).status_code, 200)

    def test_create_needs_the_create_key(self) -> None:
        self.sign_in_with("website.custom-domain.update")
        response = self.client.post(LIST, {"domain": "one.test"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_verify_and_primary_need_the_update_key(self) -> None:
        row = self.claim("one.test", CustomDomainStatus.ACTIVE)
        self.sign_in_with("website.custom-domain.create")
        self.assertEqual(self.client.post(verify_url(row)).status_code, 403)
        response = self.client.patch(detail(row), {"is_primary": True}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_delete_needs_the_delete_key(self) -> None:
        row = self.claim("one.test")
        self.sign_in_with("website.custom-domain.create", "website.custom-domain.update")
        self.assertEqual(self.client.delete(detail(row)).status_code, 403)

    def test_the_default_roles_reach_every_route(self) -> None:
        for slug in ("it_admin", "school_owner"):
            with self.subTest(role=slug):
                user = UserFactory(tenant=self.tenant)
                grant_default_role(user, slug)
                client = jwt_only_client(user)
                domain = f"{slug.replace('_', '-')}.test"
                response = client.post(LIST, {"domain": domain}, format="json")
                self.assertEqual(response.status_code, 201, response.content)
                row_id = response.json()["data"]["id"]
                self.assertEqual(client.get(LIST).status_code, 200)
                self.assertEqual(client.post(f"{LIST}/{row_id}:verify").status_code, 200)
                self.assertEqual(client.delete(f"{LIST}/{row_id}").status_code, 204)

    def test_bearer_only_client_is_served_and_foreign_ids_are_404(self) -> None:
        # L63: no `force_login` session, so the viewset must bind the tenant itself.
        mine = self.claim("mine.test")
        foreign = self.claim("theirs.test", tenant=self.make_other_tenant())
        client = jwt_only_client(self.user)
        rows = client.get(LIST).json()["data"]
        self.assertEqual([r["id"] for r in rows], [str(mine.id)])
        self.assertEqual(client.post(verify_url(foreign)).status_code, 404)
        self.assertEqual(client.post(verify_url(mine)).status_code, 200)
