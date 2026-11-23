"""Host resolution, site status and a tenant's hosts (plan decisions 2 and 7, Review Focus 2)."""

from __future__ import annotations

from django.db import IntegrityError, connection, transaction
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.website_cms.context import TenantContextMismatch
from apps.website_cms.hosts import resolve_host, tenant_hosts, website_status
from apps.website_cms.models import CustomDomainRoute, CustomDomainStatus
from apps.website_cms.tests.factories import (
    TenantFactory,
    WebsiteSettingsFactory,
    make_custom_domain,
)
from apps.website_cms.urls_builder import tenant_site_host, tenant_site_url
from core.tenancy.context import tenant_context
from core.tenancy.hosts import normalise_host
from core.tenancy.models import Tenant

PLATFORM = "schools.test"


@override_settings(PLATFORM_DOMAIN=PLATFORM)
class ResolveHostTests(TestCase):
    def setUp(self) -> None:
        self.tenant = TenantFactory(slug="greenfield")

    def test_resolve_platform_subdomain(self) -> None:
        self.assertEqual(resolve_host("greenfield.schools.test"), self.tenant)

    def test_unknown_slug_is_none(self) -> None:
        self.assertIsNone(resolve_host("nobody.schools.test"))

    def test_resolve_rejects_multi_label_subdomain(self) -> None:
        for host in ("www.greenfield.schools.test", "greenfield.app.schools.test"):
            with self.subTest(host=host):
                self.assertIsNone(resolve_host(host))

    def test_reserved_label_never_resolves(self) -> None:
        TenantFactory(slug="www")
        self.assertIsNone(resolve_host("www.schools.test"))

    def test_cname_target_label_never_resolves(self) -> None:
        # `sites.<platform>` is the custom-domain CNAME target, never a school's site.
        TenantFactory(slug="sites")
        self.assertIsNone(resolve_host("sites.schools.test"))

    def test_platform_apex_is_no_tenant(self) -> None:
        self.assertIsNone(resolve_host(PLATFORM))

    def test_resolve_is_case_and_port_insensitive(self) -> None:
        make_custom_domain(self.tenant, "www.greenfield.org", CustomDomainStatus.ACTIVE)
        for host in (
            "GreenField.Schools.TEST:3001",
            " greenfield.schools.test. ",
            "WWW.Greenfield.ORG:443",
        ):
            with self.subTest(host=host):
                self.assertEqual(resolve_host(host), self.tenant)

    def test_internationalised_domain_is_idna_encoded(self) -> None:
        make_custom_domain(self.tenant, "xn--bcher-kva.example", CustomDomainStatus.ACTIVE)
        self.assertEqual(resolve_host("Bücher.example"), self.tenant)

    def test_resolve_active_route_only(self) -> None:
        """A claim that DNS has not proven never resolves, so it cannot hijack a host."""
        for status in (
            CustomDomainStatus.PENDING_DNS,
            CustomDomainStatus.VERIFYING,
            CustomDomainStatus.FAILED,
            CustomDomainStatus.DISABLED,
        ):
            with self.subTest(status=status):
                make_custom_domain(self.tenant, f"{status.replace('_', '-')}.example.org", status)
                self.assertIsNone(resolve_host(f"{status.replace('_', '-')}.example.org"))

        make_custom_domain(self.tenant, "active.example.org", CustomDomainStatus.ACTIVE)
        self.assertEqual(resolve_host("active.example.org"), self.tenant)
        CustomDomainRoute.objects.filter(domain="active.example.org").delete()
        self.assertIsNone(resolve_host("active.example.org"))

    def test_soft_deleted_route_never_resolves(self) -> None:
        make_custom_domain(self.tenant, "gone.example.org", CustomDomainStatus.ACTIVE)
        CustomDomainRoute.objects.filter(domain="gone.example.org").update(
            deleted_at=timezone.now()
        )
        self.assertIsNone(resolve_host("gone.example.org"))
        self.assertNotIn("gone.example.org", tenant_hosts(self.tenant))

    def test_route_tenant_must_be_its_domains_tenant(self) -> None:
        """The composite foreign key: no route can point tenant A's domain at tenant B."""
        domain = make_custom_domain(self.tenant, "a.example.org", CustomDomainStatus.PENDING_DNS)
        intruder = TenantFactory()
        with self.assertRaises(IntegrityError), transaction.atomic():
            CustomDomainRoute.objects.create(
                domain="a.example.org", tenant=intruder, custom_domain=domain
            )
            # The key is deferrable like Django's own; check it now, inside the savepoint.
            connection.check_constraints()
        self.assertIsNone(resolve_host("a.example.org"))

    def test_route_for_its_own_tenant_is_accepted(self) -> None:
        domain = make_custom_domain(self.tenant, "b.example.org", CustomDomainStatus.PENDING_DNS)
        with transaction.atomic():
            CustomDomainRoute.objects.create(
                domain="b.example.org", tenant=self.tenant, custom_domain=domain
            )
            connection.check_constraints()
        self.assertEqual(resolve_host("b.example.org"), self.tenant)

    def test_another_tenants_pending_claim_does_not_steal_the_host(self) -> None:
        make_custom_domain(self.tenant, "contested.example.org", CustomDomainStatus.ACTIVE)
        make_custom_domain(TenantFactory(), "contested.example.org", CustomDomainStatus.PENDING_DNS)
        self.assertEqual(resolve_host("contested.example.org"), self.tenant)

    def test_deleted_tenant_unresolved(self) -> None:
        make_custom_domain(self.tenant, "www.greenfield.org", CustomDomainStatus.ACTIVE)
        Tenant.objects.filter(pk=self.tenant.pk).update(deleted_at=timezone.now())
        for host in ("greenfield.schools.test", "www.greenfield.org"):
            with self.subTest(host=host):
                self.assertIsNone(resolve_host(host))

    def test_suspended_tenant_still_resolves_for_by_host_to_report(self) -> None:
        Tenant.objects.filter(pk=self.tenant.pk).update(status="suspended")
        self.assertEqual(resolve_host("greenfield.schools.test"), self.tenant)

    def test_garbage_is_rejected_before_any_lookup(self) -> None:
        for host in ("", "   ", ":3001", ".", "a b.test", "evil.test/x", "a..b.test", "-a.test"):
            with self.subTest(host=host):
                self.assertIsNone(normalise_host(host))
                self.assertIsNone(resolve_host(host))


class WebsiteStatusTests(TestCase):
    def setUp(self) -> None:
        self.tenant = TenantFactory()

    def _settings(self, **kwargs) -> None:
        with tenant_context(self.tenant.id):
            WebsiteSettingsFactory(tenant=self.tenant, **kwargs)

    def test_no_settings_row_is_unpublished(self) -> None:
        self.assertEqual(website_status(self.tenant), "unpublished")

    def test_unpublished(self) -> None:
        self._settings(is_published=False, maintenance_mode=True)
        self.assertEqual(website_status(self.tenant), "unpublished")

    def test_live(self) -> None:
        self._settings(is_published=True)
        self.assertEqual(website_status(self.tenant), "live")

    def test_maintenance(self) -> None:
        self._settings(is_published=True, maintenance_mode=True)
        self.assertEqual(website_status(self.tenant), "maintenance")

    def test_deleted_settings_row_is_unpublished(self) -> None:
        self._settings(is_published=True, deleted_at=timezone.now())
        self.assertEqual(website_status(self.tenant), "unpublished")

    def test_reuses_a_binding_to_the_same_tenant(self) -> None:
        self._settings(is_published=True)
        with tenant_context(self.tenant.id):
            self.assertEqual(website_status(self.tenant), "live")

    def test_refuses_while_another_tenant_is_bound(self) -> None:
        with tenant_context(TenantFactory().id), self.assertRaises(TenantContextMismatch):
            website_status(self.tenant)

    def test_another_tenants_site_does_not_count(self) -> None:
        other = TenantFactory()
        with tenant_context(other.id):
            WebsiteSettingsFactory(tenant=other, is_published=True)
        self.assertEqual(website_status(self.tenant), "unpublished")


@override_settings(PLATFORM_DOMAIN=PLATFORM, DASHBOARD_URL_SCHEME="https", WEBSITE_URL_PORT="")
class TenantSiteHostTests(TestCase):
    def setUp(self) -> None:
        self.tenant = TenantFactory(slug="greenfield")

    def test_tenant_hosts_are_the_subdomain_then_active_domains(self) -> None:
        make_custom_domain(self.tenant, "www.greenfield.org", CustomDomainStatus.ACTIVE)
        make_custom_domain(self.tenant, "alt.greenfield.org", CustomDomainStatus.ACTIVE)
        make_custom_domain(self.tenant, "new.greenfield.org", CustomDomainStatus.PENDING_DNS)
        make_custom_domain(TenantFactory(), "other.example.org", CustomDomainStatus.ACTIVE)
        self.assertEqual(
            tenant_hosts(self.tenant),
            ["greenfield.schools.test", "alt.greenfield.org", "www.greenfield.org"],
        )

    def test_site_host_is_the_subdomain_without_a_primary_domain(self) -> None:
        make_custom_domain(self.tenant, "www.greenfield.org", CustomDomainStatus.ACTIVE)
        self.assertEqual(tenant_site_host(self.tenant), "greenfield.schools.test")

    def test_preview_url_uses_the_primary_active_custom_domain(self) -> None:
        make_custom_domain(
            self.tenant, "www.greenfield.org", CustomDomainStatus.ACTIVE, is_primary=True
        )
        self.assertEqual(
            tenant_site_url(self.tenant, "/api/preview"), "https://www.greenfield.org/api/preview"
        )

    def test_another_tenants_primary_domain_is_never_used(self) -> None:
        make_custom_domain(
            TenantFactory(), "www.other.org", CustomDomainStatus.ACTIVE, is_primary=True
        )
        self.assertEqual(tenant_site_host(self.tenant), "greenfield.schools.test")

    def test_site_host_refuses_while_another_tenant_is_bound(self) -> None:
        with tenant_context(TenantFactory().id), self.assertRaises(TenantContextMismatch):
            tenant_site_host(self.tenant)

    def test_site_host_reuses_a_binding_to_the_same_tenant(self) -> None:
        make_custom_domain(
            self.tenant, "www.greenfield.org", CustomDomainStatus.ACTIVE, is_primary=True
        )
        with tenant_context(self.tenant.id):
            self.assertEqual(tenant_site_host(self.tenant), "www.greenfield.org")

    @override_settings(DASHBOARD_URL_SCHEME="http", WEBSITE_URL_PORT="3001")
    def test_dev_url_carries_the_renderer_port(self) -> None:
        self.assertEqual(
            tenant_site_url(self.tenant, "/api/preview"),
            "http://greenfield.schools.test:3001/api/preview",
        )
