"""The beat's custom-domain sweeps: retrying claims, the daily active re-check, the schedule."""

from __future__ import annotations

from datetime import timedelta
from unittest import mock

from celery.schedules import crontab
from django.conf import settings
from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from apps.school_organization.tests.factories import grant_default_role
from apps.website_cms import tasks
from apps.website_cms.constants import ACTIVE_RECHECK_FAILURE_LIMIT
from apps.website_cms.custom_domains.adapters import DnsCheck
from apps.website_cms.custom_domains.services import (
    recheck_tenant_active_domains,
    reverify_tenant_domains,
)
from apps.website_cms.hosts import resolve_host
from apps.website_cms.models import CustomDomain, CustomDomainRoute, CustomDomainStatus
from apps.website_cms.notifications import DOMAIN_ACTIVE, DOMAIN_FAILED
from apps.website_cms.revalidation import host_tag
from apps.website_cms.tests.factories import TenantFactory, UserFactory, make_custom_domain
from apps.website_cms.urls_builder import platform_site_host, tenant_site_host
from config.celery import app
from core.notifications.models import Notification
from core.tenancy.context import tenant_context

SERVICES = "apps.website_cms.custom_domains.services"


class StubVerifier:
    def __init__(self, result: DnsCheck, during=None) -> None:
        self.result = result
        self.during = during

    def check(self, domain: str, token: str, cname_target: str) -> DnsCheck:
        if self.during is not None:
            self.during()
        return self.result


class SweepTestCase(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.it_admin = UserFactory(tenant=self.tenant)
        grant_default_role(self.it_admin, "it_admin")

    def claim(self, domain: str, status: str, *, age_hours: float = 1, **kwargs) -> CustomDomain:
        row = make_custom_domain(self.tenant, domain, status, **kwargs)
        created = timezone.now() - timedelta(hours=age_hours)
        with tenant_context(self.tenant.id):
            CustomDomain.objects.filter(pk=row.pk).update(created_at=created)
            return CustomDomain.objects.get(pk=row.pk)

    def stored(self, row: CustomDomain) -> CustomDomain:
        with tenant_context(self.tenant.id):
            return CustomDomain.all_tenants.get(pk=row.pk)

    def sent(self, event_key: str, row: CustomDomain) -> int:
        with tenant_context(self.tenant.id):
            return Notification.objects.filter(event_key=event_key, source_id=row.pk).count()


class ReverifyClaimsTests(SweepTestCase):
    def test_a_claim_whose_dns_is_now_set_goes_live(self) -> None:
        row = self.claim("www.greenfield.test", CustomDomainStatus.PENDING_DNS)
        self.assertEqual(reverify_tenant_domains(self.tenant.id), 1)
        self.assertEqual(self.stored(row).status, CustomDomainStatus.ACTIVE)
        self.assertEqual(resolve_host("www.greenfield.test"), self.tenant)
        self.assertEqual(self.sent(DOMAIN_ACTIVE, row), 1)

    def test_a_pending_claim_keeps_its_status_but_records_the_reason(self) -> None:
        row = self.claim("www.greenfield.example", CustomDomainStatus.PENDING_DNS)
        reverify_tenant_domains(self.tenant.id)
        stored = self.stored(row)
        self.assertEqual(stored.status, CustomDomainStatus.PENDING_DNS)
        self.assertIn("_schoolhub-verify", stored.last_error)

    def test_a_stuck_verifying_claim_becomes_failed(self) -> None:
        row = self.claim("www.greenfield.example", CustomDomainStatus.VERIFYING)
        reverify_tenant_domains(self.tenant.id)
        self.assertEqual(self.stored(row).status, CustomDomainStatus.FAILED)

    def test_claims_older_than_72_hours_are_left_alone(self) -> None:
        row = self.claim("www.greenfield.test", CustomDomainStatus.FAILED, age_hours=73)
        verifier = mock.Mock()
        with mock.patch(f"{SERVICES}.get_dns_verifier", return_value=verifier):
            self.assertEqual(reverify_tenant_domains(self.tenant.id), 0)
        verifier.check.assert_not_called()
        self.assertEqual(self.stored(row).status, CustomDomainStatus.FAILED)

    def test_beat_notifies_failure_once_after_24h(self) -> None:
        old = self.claim("old.example", CustomDomainStatus.FAILED, age_hours=25)
        young = self.claim("young.example", CustomDomainStatus.FAILED, age_hours=23)
        for _ in range(3):
            reverify_tenant_domains(self.tenant.id)
        self.assertEqual(self.sent(DOMAIN_FAILED, old), 1)
        self.assertEqual(self.sent(DOMAIN_FAILED, young), 0)
        self.assertIsNotNone(self.stored(old).failure_notified_at)
        self.assertIsNone(self.stored(young).failure_notified_at)

    def test_beat_result_discarded_when_domain_deleted_mid_check(self) -> None:
        row = self.claim("www.greenfield.test", CustomDomainStatus.PENDING_DNS)

        def user_deletes() -> None:
            with tenant_context(self.tenant.id):
                CustomDomain.objects.filter(pk=row.pk).update(deleted_at=timezone.now())

        stub = StubVerifier(DnsCheck(True), during=user_deletes)
        with mock.patch(f"{SERVICES}.get_dns_verifier", return_value=stub):
            self.assertEqual(reverify_tenant_domains(self.tenant.id), 0)
        stored = self.stored(row)
        self.assertIsNotNone(stored.deleted_at)
        self.assertEqual(stored.status, CustomDomainStatus.PENDING_DNS)
        self.assertFalse(CustomDomainRoute.objects.filter(custom_domain_id=row.pk).exists())
        self.assertEqual(self.sent(DOMAIN_ACTIVE, row), 0)

    def test_beat_result_discarded_when_status_changed_mid_check(self) -> None:
        # A user's own :verify settled the claim first; the sweep's stale result must not win.
        row = self.claim("www.greenfield.example", CustomDomainStatus.PENDING_DNS)

        def user_verifies() -> None:
            with tenant_context(self.tenant.id):
                CustomDomain.objects.filter(pk=row.pk).update(status=CustomDomainStatus.VERIFYING)

        stub = StubVerifier(DnsCheck(False, "stale"), during=user_verifies)
        with mock.patch(f"{SERVICES}.get_dns_verifier", return_value=stub):
            reverify_tenant_domains(self.tenant.id)
        self.assertEqual(self.stored(row).status, CustomDomainStatus.VERIFYING)
        self.assertEqual(self.stored(row).last_error, "")

    def test_the_task_sweeps_every_tenant_without_a_transaction(self) -> None:
        row = self.claim("www.greenfield.test", CustomDomainStatus.PENDING_DNS)
        summary = tasks.reverify_custom_domains()
        self.assertEqual(summary["failed"], 0)
        self.assertGreaterEqual(summary["affected"], 1)
        self.assertEqual(self.stored(row).status, CustomDomainStatus.ACTIVE)


class ActiveRecheckTests(SweepTestCase):
    def test_a_passing_recheck_resets_the_failure_count(self) -> None:
        row = self.claim("www.greenfield.test", CustomDomainStatus.ACTIVE)
        with tenant_context(self.tenant.id):
            CustomDomain.objects.filter(pk=row.pk).update(consecutive_failures=2, last_error="x")
        recheck_tenant_active_domains(self.tenant.id)
        stored = self.stored(row)
        self.assertEqual((stored.consecutive_failures, stored.last_error), (0, ""))

    def test_active_domain_dropped_after_three_failed_rechecks(self) -> None:
        row = self.claim("www.greenfield.example", CustomDomainStatus.ACTIVE, is_primary=True)
        for attempt in range(1, ACTIVE_RECHECK_FAILURE_LIMIT):
            recheck_tenant_active_domains(self.tenant.id)
            stored = self.stored(row)
            self.assertEqual(stored.status, CustomDomainStatus.ACTIVE)
            self.assertEqual(stored.consecutive_failures, attempt)
            self.assertEqual(resolve_host("www.greenfield.example"), self.tenant)
        with mock.patch(f"{SERVICES}.queue_revalidation") as revalidate:
            self.assertEqual(recheck_tenant_active_domains(self.tenant.id), 1)
        stored = self.stored(row)
        self.assertEqual(stored.status, CustomDomainStatus.FAILED)
        self.assertFalse(stored.is_primary)
        self.assertEqual(stored.consecutive_failures, ACTIVE_RECHECK_FAILURE_LIMIT)
        self.assertIsNone(resolve_host("www.greenfield.example"))
        self.assertFalse(CustomDomainRoute.objects.filter(custom_domain_id=row.pk).exists())
        self.assertEqual(tenant_site_host(self.tenant), platform_site_host(self.tenant))
        self.assertEqual(self.sent(DOMAIN_FAILED, row), 1)
        self.assertIn(host_tag("www.greenfield.example"), revalidate.call_args.args[1])
        # A lapsed domain is no longer re-checked daily, so nothing is sent again.
        recheck_tenant_active_domains(self.tenant.id)
        self.assertEqual(self.sent(DOMAIN_FAILED, row), 1)

    def test_recheck_discarded_when_domain_deleted_mid_check(self) -> None:
        row = self.claim("www.greenfield.example", CustomDomainStatus.ACTIVE)
        with tenant_context(self.tenant.id):
            CustomDomain.objects.filter(pk=row.pk).update(
                consecutive_failures=ACTIVE_RECHECK_FAILURE_LIMIT - 1
            )

        def user_deletes() -> None:
            with tenant_context(self.tenant.id):
                CustomDomain.objects.filter(pk=row.pk).update(deleted_at=timezone.now())

        stub = StubVerifier(DnsCheck(False, "gone"), during=user_deletes)
        with mock.patch(f"{SERVICES}.get_dns_verifier", return_value=stub):
            self.assertEqual(recheck_tenant_active_domains(self.tenant.id), 0)
        self.assertEqual(self.sent(DOMAIN_FAILED, row), 0)

    def test_the_daily_task_runs(self) -> None:
        row = self.claim("www.greenfield.example", CustomDomainStatus.ACTIVE)
        summary = tasks.recheck_active_custom_domains()
        self.assertEqual(summary["failed"], 0)
        self.assertEqual(self.stored(row).consecutive_failures, 1)


class BeatScheduleTests(SimpleTestCase):
    def test_the_sweeps_are_scheduled_and_registered(self) -> None:
        app.loader.import_default_modules()
        expected = {
            "reverify-custom-domains": (
                "website_cms.reverify_custom_domains",
                crontab(minute="*/15"),
            ),
            "recheck-active-custom-domains": (
                "website_cms.recheck_active_custom_domains",
                crontab(hour="2", minute="50"),
            ),
        }
        for name, (task, schedule) in expected.items():
            with self.subTest(entry=name):
                entry = settings.CELERY_BEAT_SCHEDULE[name]
                self.assertEqual(entry["task"], task)
                self.assertEqual(entry["schedule"], schedule)
                self.assertIn(task, app.tasks)
