"""Usage snapshots: the counters, the nightly visit, the console's usage routes, and the
409 `limit_below_usage` that reads them (ruling C3).

A snapshot is a platform-scope row of aggregate counts, written with one school bound at a
time; the console and the platform reports read it with nothing bound (multi-tenancy §8).
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework import status

from apps.platform_admin import tasks
from apps.platform_admin.models import TenantUsageSnapshot
from apps.platform_admin.subscriptions import services as subscriptions
from apps.platform_admin.tests.base import (
    PLANS_URL,
    PlatformAPITestCase,
    bearer,
    make_plan,
    make_tenant,
    platform_user,
    subscription_url,
    tenant_url,
)
from apps.platform_admin.tests.test_subscriptions import live_on
from apps.platform_admin.usage import services as usage
from apps.school_organization.tests.factories import CampusFactory, UserFactory, grant
from apps.staff_management.models import EmploymentStatus
from apps.staff_management.tests.factories import StaffFactory
from apps.student_management.models import StudentStatus
from apps.student_management.tests.factories import StudentFactory
from core.files.tests.factories import FileFactory
from core.tenancy.context import TenantContextRequired, tenant_atomic, tenant_context
from core.tenancy.features import registry as feature_registry
from core.tenancy.grants import append_only_tables
from core.tenancy.models import Tenant, TenantStatus

S = TenantStatus
GIB = 1024**3

# Every column a snapshot may hold: aggregates and the school's plan state, never a row of
# school data (a name, an email, a student). A new column must be added here on purpose.
SNAPSHOT_FIELDS = {
    "id",
    "tenant",
    "taken_at",
    "status",
    "plan_code",
    "mrr_amount",
    "currency",
    "students",
    "staff",
    "storage_bytes",
    "impersonations_30d",
    "modules_enabled",
}


def snapshot_of(tenant: Tenant, *, ago: timedelta | None = None, **counts) -> TenantUsageSnapshot:
    """A snapshot of ``tenant`` written directly (the table is platform scope)."""
    fields = {"status": tenant.status, "students": 0, "staff": 0, "storage_bytes": 0, **counts}
    if ago is not None:
        fields["taken_at"] = timezone.now() - ago
    return TenantUsageSnapshot.objects.create(tenant=tenant, **fields)


def usage_url(tenant: Tenant) -> str:
    return tenant_url(tenant, "/usage")


def plan_url(plan) -> str:
    return f"{PLANS_URL}/{plan.pk}"


def populate(tenant: Tenant, *, students=(), staff=(), files=()) -> None:
    """Students and staff at the given statuses, and files of the given sizes, in ``tenant``."""
    with tenant_context(tenant.pk):
        campus = CampusFactory(tenant=tenant)
        for student_status in students:
            StudentFactory(tenant=tenant, campus=campus, status=student_status)
        for employment_status in staff:
            StaffFactory(tenant=tenant, campus=campus, employment_status=employment_status)
        for size in files:
            FileFactory(tenant=tenant, size_bytes=size)


class UsageCounterTests(TestCase):
    def test_counters_match_definitions(self) -> None:
        tenant, other = make_tenant(status=S.ACTIVE), make_tenant(status=S.ACTIVE)
        populate(
            tenant,
            # Counted: anyone still on the roll, a suspended student included.
            students=[StudentStatus.ACTIVE, StudentStatus.SUSPENDED]
            # Not counted: a student who has left.
            + [StudentStatus.WITHDRAWN, StudentStatus.GRADUATED, StudentStatus.TRANSFERRED],
            staff=[EmploymentStatus.ACTIVE, EmploymentStatus.ON_LEAVE, EmploymentStatus.SUSPENDED]
            + [EmploymentStatus.RESIGNED, EmploymentStatus.RETIRED, EmploymentStatus.TERMINATED],
            files=[3 * GIB, 512],
        )
        # Soft-deleted rows are gone for the count, whatever their status.
        now = timezone.now()
        with tenant_context(tenant.pk):
            campus = CampusFactory(tenant=tenant)
            StudentFactory(tenant=tenant, campus=campus, deleted_at=now)
            StaffFactory(tenant=tenant, campus=campus, deleted_at=now)
            FileFactory(tenant=tenant, size_bytes=GIB, deleted_at=now)
        # Another school's rows never reach this one's counts.
        populate(
            other,
            students=[StudentStatus.ACTIVE],
            staff=[EmploymentStatus.ACTIVE],
            files=[7 * GIB],
        )

        with tenant_atomic(tenant.pk):
            self.assertEqual(usage.count_students(tenant.pk), 2)
            self.assertEqual(usage.count_staff(tenant.pk), 3)
            self.assertEqual(usage.count_storage_bytes(tenant.pk), 3 * GIB + 512)
            self.assertEqual(
                {metric: counter(tenant.pk) for metric, counter in usage.USAGE_COUNTERS.items()},
                {
                    "students": 2,
                    "staff": 3,
                    "storage_gb": Decimal(3 * GIB + 512) / GIB,
                },
            )

    def test_a_counter_refuses_a_school_that_is_not_bound(self) -> None:
        tenant, other = make_tenant(status=S.ACTIVE), make_tenant(status=S.ACTIVE)

        with tenant_atomic(other.pk):
            for counter in usage.USAGE_COUNTERS.values():
                with self.subTest(counter=counter), self.assertRaises(TenantContextRequired):
                    counter(tenant.pk)
            with self.assertRaises(TenantContextRequired):
                usage.snapshot_tenant(tenant.pk)


class SnapshotTests(TestCase):
    def test_snapshot_fields_are_aggregates_only(self) -> None:
        fields = {field.name for field in TenantUsageSnapshot._meta.get_fields()}

        self.assertEqual(fields, SNAPSHOT_FIELDS)

    def test_snapshot_records_the_counts_and_the_plan_per_month(self) -> None:
        tenant = make_tenant(status=S.TRIAL)
        plan = make_plan(
            code="annual-pro",
            price_amount="120000.00",
            currency="PKR",
            billing_period="annual",
            enabled_modules=["module.timetable"],
        )
        live_on(tenant, plan)
        populate(tenant, students=[StudentStatus.ACTIVE] * 3, staff=[EmploymentStatus.ACTIVE])

        with tenant_atomic(tenant.pk):
            snap = usage.snapshot_tenant(tenant.pk)

        self.assertEqual(snap.tenant_id, tenant.pk)
        self.assertEqual(snap.status, S.ACTIVE)
        self.assertEqual(snap.plan_code, "annual-pro")
        # An annual price, normalised to a month.
        self.assertEqual(snap.mrr_amount, Decimal("10000.00"))
        self.assertEqual(snap.currency, "PKR")
        self.assertEqual((snap.students, snap.staff, snap.storage_bytes), (3, 1, 0))
        # No grant was taken for this school (test_impersonation.py counts real ones).
        self.assertEqual(snap.impersonations_30d, 0)
        self.assertIn("module.timetable", snap.modules_enabled)
        left_out = sorted(
            spec.key
            for spec in feature_registry.all()
            if spec.key.startswith("module.") and spec.key != "module.timetable"
        )
        self.assertTrue(left_out, "no second module flag to check against")
        # The plan decides every `module.*` key: one it lacks is off.
        self.assertNotIn(left_out[0], snap.modules_enabled)

    def test_a_trial_or_a_school_without_a_plan_brings_no_revenue(self) -> None:
        trial = make_tenant(status=S.TRIAL)
        subscriptions.start_trial(trial, make_plan(code="trial-plan"), actor_id=None)
        bare = make_tenant(status=S.PROVISIONING)

        with tenant_atomic(trial.pk):
            on_trial = usage.snapshot_tenant(trial.pk)
        with tenant_atomic(bare.pk):
            no_plan = usage.snapshot_tenant(bare.pk)

        self.assertEqual((on_trial.plan_code, on_trial.mrr_amount), ("trial-plan", Decimal("0")))
        self.assertEqual((no_plan.plan_code, no_plan.mrr_amount), ("", Decimal("0")))

    def test_a_past_due_school_pays_its_monthly_price(self) -> None:
        tenant = make_tenant(status=S.TRIAL)
        sub = live_on(tenant, make_plan(price_amount="5000.00", billing_period="monthly"))
        subscriptions.mark_payment_failed(sub, actor_id=None)

        with tenant_atomic(tenant.pk):
            snap = usage.snapshot_tenant(tenant.pk)

        # Late, not lost: a past-due school still counts toward revenue, at the monthly price.
        self.assertEqual(snap.status, S.PAST_DUE)
        self.assertEqual(snap.mrr_amount, Decimal("5000.00"))

    def test_snapshot_is_append_only(self) -> None:
        snap = snapshot_of(make_tenant(status=S.ACTIVE), students=4)

        snap.students = 5
        with self.assertRaises(RuntimeError):
            snap.save()
        with self.assertRaises(RuntimeError):
            snap.delete()
        with self.assertRaises(RuntimeError):
            TenantUsageSnapshot.objects.filter(pk=snap.pk).update(students=6)
        with self.assertRaises(RuntimeError):
            TenantUsageSnapshot.objects.filter(pk=snap.pk).delete()
        # The database grant is the real boundary: the table is in the coverage list, so
        # `tests/test_append_only_coverage.py` checks UPDATE and DELETE are revoked.
        self.assertEqual(append_only_tables().get("tenant_usage_snapshots"), frozenset())
        self.assertEqual(TenantUsageSnapshot.objects.get(pk=snap.pk).students, 4)

    def test_snapshot_all_visits_suspended_tenants(self) -> None:
        active = make_tenant(status=S.ACTIVE)
        suspended = make_tenant(status=S.SUSPENDED)
        deprovisioned = make_tenant(status=S.DEPROVISIONED)
        removed = make_tenant(status=S.ACTIVE, deleted_at=timezone.now())
        populate(active, students=[StudentStatus.ACTIVE] * 2)
        populate(suspended, students=[StudentStatus.ACTIVE])

        result = tasks.snapshot_all()

        self.assertEqual(result["failed"], 0)
        for tenant, students in ((active, 2), (suspended, 1), (deprovisioned, 0)):
            with self.subTest(tenant=tenant.status):
                snap = TenantUsageSnapshot.objects.get(tenant=tenant)
                self.assertEqual(snap.status, tenant.status)
                # One school bound per step: each counts its own students only.
                self.assertEqual(snap.students, students)
        self.assertFalse(TenantUsageSnapshot.objects.filter(tenant=removed).exists())

    def test_latest_snapshot_is_the_newest(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)
        snapshot_of(tenant, ago=timedelta(days=1), students=9)
        newest = snapshot_of(tenant, students=3)
        snapshot_of(make_tenant(status=S.ACTIVE), students=99)

        self.assertEqual(usage.latest_snapshot(tenant.pk), newest)
        self.assertIsNone(usage.latest_snapshot(make_tenant().pk))


class UsageRouteTests(PlatformAPITestCase):
    def test_usage_returns_the_latest_snapshot_and_the_limits(self) -> None:
        tenant = make_tenant(status=S.TRIAL)
        live_on(tenant, make_plan(limits={"students": 100}))
        snapshot_of(tenant, ago=timedelta(days=1), students=9)
        snapshot_of(tenant, students=12, storage_bytes=GIB)

        response = self.client.get(usage_url(tenant))

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        data = response.json()["data"]
        self.assertEqual(data["snapshot"]["students"], 12)
        self.assertEqual(data["snapshot"]["storage_bytes"], GIB)
        self.assertEqual(data["limits"]["students"], 100)
        self.assertIsNone(data["limits"]["sms_credits"])

    def test_usage_without_a_snapshot_is_null(self) -> None:
        tenant = make_tenant(status=S.TRIAL)

        response = self.client.get(usage_url(tenant))

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertIsNone(response.json()["data"]["snapshot"])

    def test_refresh_usage_snapshots_one_tenant_now(self) -> None:
        tenant, other = make_tenant(status=S.ACTIVE), make_tenant(status=S.ACTIVE)
        populate(tenant, students=[StudentStatus.ACTIVE] * 2)
        # Support reads usage: the action is gated on the view key, not a write key.
        self.sign_in_as(platform_user("platform_support"))

        response = self.client.post(tenant_url(tenant, ":refresh-usage"))

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertEqual(response.json()["data"]["snapshot"]["students"], 2)
        self.assertEqual(TenantUsageSnapshot.objects.filter(tenant=tenant).count(), 1)
        self.assertFalse(TenantUsageSnapshot.objects.filter(tenant=other).exists())

    def test_usage_of_other_tenant_404(self) -> None:
        mine, theirs = make_tenant(status=S.ACTIVE), make_tenant(status=S.ACTIVE)
        snapshot_of(theirs, students=5)
        principal = UserFactory(tenant=mine)
        grant(principal, "platform.job.view")

        # A school's own principal never reaches the console, for any school.
        self.client.credentials(HTTP_AUTHORIZATION=bearer(principal))
        for tenant in (mine, theirs):
            with self.subTest(tenant=tenant.slug):
                self.assertEqual(
                    self.client.get(usage_url(tenant)).status_code, status.HTTP_404_NOT_FOUND
                )
                self.assertEqual(
                    self.client.post(tenant_url(tenant, ":refresh-usage")).status_code,
                    status.HTTP_404_NOT_FOUND,
                )
        self.assertEqual(TenantUsageSnapshot.objects.filter(tenant=mine).count(), 0)

        # An operator naming a school that does not exist gets 404 too.
        self.sign_in_as(self.operator)
        ghost = Tenant(pk="00000000-0000-0000-0000-000000000000")
        self.assertEqual(self.client.get(usage_url(ghost)).status_code, status.HTTP_404_NOT_FOUND)

    def test_an_operator_without_the_key_is_403(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)
        self.sign_in_as(platform_user(None))

        self.assertEqual(self.client.get(usage_url(tenant)).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(
            self.client.post(tenant_url(tenant, ":refresh-usage")).status_code,
            status.HTTP_403_FORBIDDEN,
        )


class LimitBelowUsageTests(PlatformAPITestCase):
    """Review Focus 4: a limit lowered below a school's latest snapshot needs the ack."""

    def test_lowering_limit_below_usage_is_409(self) -> None:
        plan = make_plan(limits={"students": 500, "sms_credits": 1000})
        tenant = make_tenant(status=S.TRIAL)
        live_on(tenant, plan)
        snapshot_of(tenant, students=50)

        refused = self.client.patch(
            plan_url(plan), {"limits": {"students": 10, "sms_credits": 1000}}, format="json"
        )

        self.assert_error(refused, status.HTTP_409_CONFLICT, "limit_below_usage")
        self.assertEqual(
            refused.json()["error"]["meta"]["over_usage"],
            [{"tenant_id": str(tenant.pk), "metric": "students", "limit": 10, "usage": 50}],
        )
        plan.refresh_from_db()
        self.assertEqual(plan.limits["students"], 500)

        # Still above usage: no acknowledgement needed.
        above = self.client.patch(plan_url(plan), {"limits": {"students": 60}}, format="json")
        self.assertEqual(above.status_code, status.HTTP_200_OK, above.content)

        acknowledged = self.client.patch(
            plan_url(plan),
            {"limits": {"students": 10}, "acknowledge_over_usage": True},
            format="json",
        )
        self.assertEqual(acknowledged.status_code, status.HTTP_200_OK, acknowledged.content)
        plan.refresh_from_db()
        self.assertEqual(plan.limits, {"students": 10})

    def test_storage_is_checked_in_gib(self) -> None:
        plan = make_plan(limits={"storage_gb": 10})
        tenant = make_tenant(status=S.TRIAL)
        live_on(tenant, plan)
        snapshot_of(tenant, storage_bytes=3 * GIB)

        refused = self.client.patch(plan_url(plan), {"limits": {"storage_gb": 2}}, format="json")

        self.assert_error(refused, status.HTTP_409_CONFLICT, "limit_below_usage")
        breach = refused.json()["error"]["meta"]["over_usage"][0]
        self.assertEqual((breach["metric"], breach["limit"]), ("storage_gb", 2))
        allowed = self.client.patch(plan_url(plan), {"limits": {"storage_gb": 3}}, format="json")
        self.assertEqual(allowed.status_code, status.HTTP_200_OK, allowed.content)

    def test_only_the_latest_snapshot_and_this_plan_s_schools_count(self) -> None:
        plan = make_plan(limits={"students": 500})
        tenant = make_tenant(status=S.TRIAL)
        live_on(tenant, plan)
        snapshot_of(tenant, ago=timedelta(days=2), students=80)
        snapshot_of(tenant, students=5)
        # A busy school on another plan is not this plan's concern.
        elsewhere = make_tenant(status=S.TRIAL)
        live_on(elsewhere, make_plan())
        snapshot_of(elsewhere, students=900)

        response = self.client.patch(plan_url(plan), {"limits": {"students": 10}}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)

    def test_deprovisioned_and_deleted_schools_do_not_count(self) -> None:
        plan = make_plan(limits={"students": 500})
        for gone in ({"status": S.DEPROVISIONED}, {"deleted_at": timezone.now()}):
            tenant = make_tenant(status=S.TRIAL)
            live_on(tenant, plan)
            snapshot_of(tenant, students=900)
            Tenant.objects.filter(pk=tenant.pk).update(**gone)

        response = self.client.patch(plan_url(plan), {"limits": {"students": 10}}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)

    def test_quotas_outside_the_counted_three_are_not_checked(self) -> None:
        plan = make_plan(limits={"sms_credits": 1000, "ai_tokens": 1000})
        tenant = make_tenant(status=S.TRIAL)
        live_on(tenant, plan)
        snapshot_of(tenant, students=50)

        response = self.client.patch(
            plan_url(plan), {"limits": {"sms_credits": 0, "ai_tokens": 0}}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)

    def test_lowering_override_below_usage_is_409(self) -> None:
        tenant = make_tenant(status=S.TRIAL)
        live_on(tenant, make_plan(limits={"students": 500}))
        snapshot_of(tenant, students=50)

        refused = self.client.patch(
            subscription_url(tenant), {"limits_override": {"students": 10}}, format="json"
        )

        self.assert_error(refused, status.HTTP_409_CONFLICT, "limit_below_usage")
        self.assertEqual(refused.json()["error"]["meta"]["over_usage"][0]["usage"], 50)

        acknowledged = self.client.patch(
            subscription_url(tenant),
            {"limits_override": {"students": 10}, "acknowledge_over_usage": True},
            format="json",
        )
        self.assertEqual(acknowledged.status_code, status.HTTP_200_OK, acknowledged.content)
        self.assertEqual(acknowledged.json()["data"]["limits"]["students"], 10)

    def test_change_plan_below_usage_is_409(self) -> None:
        tenant = make_tenant(status=S.TRIAL)
        live_on(tenant, make_plan(limits={"students": 500}))
        smaller = make_plan(limits={"students": 10})
        snapshot_of(tenant, students=50)

        refused = self.client.post(
            subscription_url(tenant, ":change-plan"), {"plan_code": smaller.code}, format="json"
        )

        self.assert_error(refused, status.HTTP_409_CONFLICT, "limit_below_usage")
        self.assertEqual(
            refused.json()["error"]["meta"]["over_usage"],
            [{"tenant_id": str(tenant.pk), "metric": "students", "limit": 10, "usage": 50}],
        )
        self.assertNotEqual(Tenant.objects.get(pk=tenant.pk).current_plan, smaller.code)

        acknowledged = self.client.post(
            subscription_url(tenant, ":change-plan"),
            {"plan_code": smaller.code, "acknowledge_over_usage": True},
            format="json",
        )
        self.assertEqual(acknowledged.status_code, status.HTTP_200_OK, acknowledged.content)
        self.assertEqual(Tenant.objects.get(pk=tenant.pk).current_plan, smaller.code)
