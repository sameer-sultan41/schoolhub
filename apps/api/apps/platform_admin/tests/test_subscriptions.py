"""Subscriptions: the services, the console's nested routes and the school's own view (§16).

Every subscription write updates the row, then the `tenants` read model, then the school's
lifecycle, then the feature cache (Review Focus 4), all in one transaction.
"""

from __future__ import annotations

from datetime import timedelta

from django.db import IntegrityError, transaction
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.platform_admin.constants import QUOTA_METRICS
from apps.platform_admin.models import Subscription, SubscriptionStatus
from apps.platform_admin.subscriptions import services
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
from apps.school_organization.tests.factories import (
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
)
from core.api.exceptions import DomainRuleViolation
from core.audit.models import AuditLog
from core.rbac.models import Role, UserRole
from core.rbac.roles import SCHOOL_OWNER
from core.tenancy import subscription_state
from core.tenancy.context import tenant_context
from core.tenancy.models import Tenant, TenantStatus

S = TenantStatus
SUB = SubscriptionStatus
TIMETABLE = "module.timetable"
# A `module.timetable` route any holder of the view key reads (apps/timetable/rooms).
ROOMS_URL = "/api/v1/rooms"
TIMETABLE_VIEW = "timetable.timetable.view"


def whole_seconds(moment):
    """DRF's JSON encoder drops sub-millisecond precision; compare whole seconds."""
    return moment.replace(microsecond=0)


def live_on(tenant: Tenant, plan, *, actor_id=None) -> Subscription:
    """``tenant`` paying for ``plan``: a trial started and then activated."""
    trial = services.start_trial(tenant, plan, actor_id=actor_id)
    now = timezone.now()
    return services.activate(
        trial, period_start=now, period_end=now + timedelta(days=30), actor_id=actor_id
    )


def reload(tenant: Tenant) -> Tenant:
    return Tenant.objects.get(pk=tenant.pk)


def subscriptions_of(tenant: Tenant) -> list[Subscription]:
    with tenant_context(tenant.pk):
        return list(Subscription.objects.all())


class SubscriptionServiceTests(PlatformAPITestCase):
    def test_live_states_are_the_subscription_statuses(self) -> None:
        self.assertEqual(subscription_state.LIVE_STATES, {SUB.TRIALING, SUB.ACTIVE, SUB.PAST_DUE})

    def test_one_live_subscription_per_tenant(self) -> None:
        tenant = make_tenant(status=S.TRIAL)
        plan = make_plan()
        services.start_trial(tenant, plan, actor_id=None)

        with self.assertRaises(services.SubscriptionExists):
            services.start_trial(tenant, make_plan(), actor_id=None)

        # The partial unique index holds even for a writer that skips the service.
        now = timezone.now()
        with tenant_context(tenant.pk), self.assertRaises(IntegrityError), transaction.atomic():
            Subscription.objects.create(
                tenant=tenant,
                plan=plan,
                status=SUB.ACTIVE,
                current_period_start=now,
                current_period_end=now + timedelta(days=30),
            )
        # A canceled one beside the live one is history, not a second subscription.
        with tenant_context(tenant.pk):
            Subscription.objects.create(
                tenant=tenant,
                plan=plan,
                status=SUB.CANCELED,
                current_period_start=now - timedelta(days=60),
                current_period_end=now - timedelta(days=30),
                canceled_at=now - timedelta(days=30),
            )
        self.assertEqual(
            [sub.status for sub in subscriptions_of(tenant) if sub.status != SUB.CANCELED],
            [SUB.TRIALING],
        )

    def test_tenant_columns_follow_subscription(self) -> None:
        tenant = make_tenant(status=S.TRIAL)
        basic, premium = make_plan(code="basic"), make_plan(code="premium")

        trial = services.start_trial(tenant, basic, actor_id=self.operator.pk)
        row = reload(tenant)
        self.assertEqual((row.current_plan, row.subscription_status), ("basic", SUB.TRIALING))
        self.assertEqual(row.status, S.TRIAL)

        now = timezone.now()
        active = services.activate(
            trial,
            period_start=now,
            period_end=now + timedelta(days=30),
            actor_id=self.operator.pk,
        )
        row = reload(tenant)
        self.assertEqual((row.subscription_status, row.status), (SUB.ACTIVE, S.ACTIVE))

        failed = services.mark_payment_failed(active, actor_id=self.operator.pk)
        row = reload(tenant)
        self.assertEqual((row.subscription_status, row.status), (SUB.PAST_DUE, S.PAST_DUE))

        moved = services.change_plan(failed, premium, actor_id=self.operator.pk)
        row = reload(tenant)
        self.assertEqual((row.current_plan, row.subscription_status), ("premium", SUB.PAST_DUE))

        services.update_subscription(
            moved, data={"billing_provider_ref": "inv-acct-42"}, actor_id=self.operator.pk
        )
        self.assertEqual(reload(tenant).billing_provider_ref, "inv-acct-42")
        self.assertEqual(len(subscriptions_of(tenant)), 1)

    def test_record_payment_recovers_past_due(self) -> None:
        tenant = make_tenant(status=S.TRIAL)
        past_due = services.mark_payment_failed(live_on(tenant, make_plan()), actor_id=None)
        self.assertEqual(reload(tenant).status, S.PAST_DUE)
        paid_through = timezone.now() + timedelta(days=60)

        recovered = services.record_payment(past_due, paid_through=paid_through, actor_id=None)

        self.assertEqual(recovered.status, SUB.ACTIVE)
        self.assertEqual(recovered.current_period_end, paid_through)
        row = reload(tenant)
        self.assertEqual((row.status, row.subscription_status), (S.ACTIVE, SUB.ACTIVE))

    def test_a_payment_must_reach_past_the_paid_period(self) -> None:
        tenant = make_tenant(status=S.TRIAL)
        sub = live_on(tenant, make_plan())

        with self.assertRaises(Exception) as caught:
            services.record_payment(sub, paid_through=sub.current_period_end, actor_id=None)

        self.assertIn("paid_through", str(caught.exception.detail))

    def test_a_move_the_subscription_cannot_make_is_invalid_transition(self) -> None:
        tenant = make_tenant(status=S.TRIAL)
        trial = services.start_trial(tenant, make_plan(), actor_id=None)

        for attempt in (
            lambda: services.mark_payment_failed(trial, actor_id=None),
            lambda: services.record_payment(
                trial, paid_through=timezone.now() + timedelta(days=30), actor_id=None
            ),
        ):
            with self.subTest(attempt=attempt), self.assertRaises(Exception) as caught:
                attempt()
            self.assertEqual(caught.exception.default_code, "invalid_transition")

    def test_an_inactive_or_retired_plan_takes_no_new_subscriber(self) -> None:
        tenant = make_tenant(status=S.TRIAL)
        for plan in (
            make_plan(is_active=False),
            make_plan(deleted_at=timezone.now()),
        ):
            with self.subTest(plan=plan.code), self.assertRaises(DomainRuleViolation):
                services.start_trial(tenant, plan, actor_id=None)
        self.assertEqual(subscriptions_of(tenant), [])

    def test_system_caller_audits_through_record_system_audit(self) -> None:
        tenant = make_tenant(status=S.TRIAL)
        sub = live_on(tenant, make_plan())

        services.mark_payment_failed(sub, actor_id=None)

        row = AuditLog.objects.get(action="mark_payment_failed", resource_id=sub.pk)
        self.assertIsNone(row.actor_id)
        self.assertEqual(row.tenant_id, tenant.pk)
        self.assertEqual(row.after["status"], SUB.PAST_DUE)

    def test_live_subscription_and_effective_limits(self) -> None:
        tenant = make_tenant(status=S.TRIAL)
        unlimited = dict.fromkeys(QUOTA_METRICS)
        self.assertIsNone(services.live_subscription(tenant.pk))
        self.assertEqual(services.effective_limits(tenant.pk), unlimited)

        plan = make_plan(limits={"students": 100, "staff": 20, "storage_gb": None})
        sub = live_on(tenant, plan)
        services.update_subscription(
            sub, data={"limits_override": {"students": 150}}, actor_id=None
        )

        self.assertEqual(services.live_subscription(tenant.pk).pk, sub.pk)
        self.assertEqual(
            services.effective_limits(tenant.pk), {**unlimited, "students": 150, "staff": 20}
        )

    def test_the_subscription_state_hook_reads_the_live_subscription(self) -> None:
        tenant = make_tenant(status=S.TRIAL)
        self.assertIsNone(subscription_state.live_subscription_state(tenant))

        services.start_trial(tenant, make_plan(), actor_id=None)

        self.assertEqual(subscription_state.live_subscription_state(tenant), SUB.TRIALING)


class SubscriptionRouteTests(PlatformAPITestCase):
    def act(self, tenant, action: str, body: dict | None = None, **kwargs):
        return self.client.post(
            subscription_url(tenant, f":{action}"), body or {}, format="json", **kwargs
        )

    def test_get_shows_the_live_subscription_and_its_limits(self) -> None:
        tenant = make_tenant(status=S.TRIAL)
        plain = self.client.get(subscription_url(tenant))
        self.assertEqual(plain.status_code, status.HTTP_200_OK, plain.content)
        self.assertIsNone(plain.json()["data"]["subscription"])
        self.assertEqual(plain.json()["data"]["tenant_status"], S.TRIAL)

        plan = make_plan(code="standard", limits={"students": 300})
        services.start_trial(tenant, plan, actor_id=None)

        data = self.client.get(subscription_url(tenant)).json()["data"]
        self.assertEqual(data["subscription"]["status"], SUB.TRIALING)
        self.assertEqual(data["subscription"]["plan"]["code"], "standard")
        self.assertEqual(data["limits"]["students"], 300)

    def test_activate_without_a_subscription_needs_a_plan(self) -> None:
        tenant = make_tenant(status=S.TRIAL)
        plan = make_plan(code="standard")
        start = whole_seconds(timezone.now())
        period = {"current_period_start": start, "current_period_end": start + timedelta(days=30)}

        missing = self.act(tenant, "activate", period)
        self.assertEqual(missing.status_code, status.HTTP_400_BAD_REQUEST, missing.content)

        response = self.act(tenant, "activate", {**period, "plan_code": "standard"})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        data = response.json()["data"]
        self.assertEqual(data["tenant_status"], S.ACTIVE)
        self.assertEqual(data["subscription"]["status"], SUB.ACTIVE)
        row = reload(tenant)
        self.assertEqual((row.status, row.current_plan), (S.ACTIVE, plan.code))
        audit = AuditLog.objects.get(action="activate", resource_type="platform_admin.subscription")
        self.assertEqual((audit.actor_id, audit.tenant_id), (self.operator.pk, tenant.pk))

    def test_activate_a_trial_then_fail_and_recover_through_the_routes(self) -> None:
        tenant = make_tenant(status=S.TRIAL)
        services.start_trial(tenant, make_plan(), actor_id=None)
        start = whole_seconds(timezone.now())

        activated = self.act(
            tenant,
            "activate",
            {"current_period_start": start, "current_period_end": start + timedelta(days=30)},
            HTTP_IDEMPOTENCY_KEY="activate-1",
        )
        replayed = self.act(
            tenant,
            "activate",
            {"current_period_start": start, "current_period_end": start + timedelta(days=30)},
            HTTP_IDEMPOTENCY_KEY="activate-1",
        )
        failed = self.act(tenant, "mark-payment-failed")
        recovered = self.act(tenant, "record-payment", {"paid_through": start + timedelta(days=60)})

        self.assertEqual(activated.status_code, status.HTTP_200_OK, activated.content)
        self.assertEqual(replayed.json()["data"], activated.json()["data"])
        self.assertEqual(failed.json()["data"]["tenant_status"], S.PAST_DUE)
        self.assertEqual(recovered.status_code, status.HTTP_200_OK, recovered.content)
        self.assertEqual(recovered.json()["data"]["tenant_status"], S.ACTIVE)

    def test_patch_writes_the_billing_reference_to_the_tenant(self) -> None:
        tenant, other = make_tenant(status=S.TRIAL), make_tenant(status=S.TRIAL)
        services.start_trial(tenant, make_plan(), actor_id=None)
        services.start_trial(other, make_plan(), actor_id=None)
        self.client.patch(
            subscription_url(other), {"billing_provider_ref": "acct-1"}, format="json"
        )

        taken = self.client.patch(
            subscription_url(tenant), {"billing_provider_ref": "acct-1"}, format="json"
        )
        self.assertEqual(taken.status_code, status.HTTP_400_BAD_REQUEST, taken.content)

        response = self.client.patch(
            subscription_url(tenant),
            {"billing_provider": "manual", "billing_provider_ref": "acct-2"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertEqual(reload(tenant).billing_provider_ref, "acct-2")
        self.assertEqual(response.json()["data"]["subscription"]["billing_provider"], "manual")

    def test_patch_without_a_subscription_is_409(self) -> None:
        tenant = make_tenant(status=S.TRIAL)

        response = self.client.patch(
            subscription_url(tenant), {"billing_provider": "manual"}, format="json"
        )

        self.assert_error(response, status.HTTP_409_CONFLICT, "no_live_subscription")

    def test_nested_subscription_of_other_tenant_404(self) -> None:
        mine, theirs = TenantFactory(), TenantFactory()
        services.start_trial(theirs, make_plan(code="theirs"), actor_id=None)
        owner = UserFactory(tenant=mine)
        grant(owner, "school.subscription.view", "platform.job.view")

        # A school's own principal never reaches the console, for any school.
        self.client.credentials(HTTP_AUTHORIZATION=bearer(owner))
        for tenant in (mine, theirs):
            with self.subTest(tenant=tenant.slug):
                self.assertEqual(
                    self.client.get(subscription_url(tenant)).status_code,
                    status.HTTP_404_NOT_FOUND,
                )
                self.assertEqual(
                    self.act(tenant, "mark-payment-failed").status_code,
                    status.HTTP_404_NOT_FOUND,
                )

        # Its own `/subscription` shows its own school, never the other's.
        school = APIClient()
        authenticate(school, owner)
        own = school.get("/api/v1/subscription")
        self.assertEqual(own.status_code, status.HTTP_200_OK, own.content)
        self.assertIsNone(own.json()["data"]["subscription"])

        # An operator naming a school that does not exist gets 404 too.
        self.sign_in_as(self.operator)
        ghost = Tenant(pk="00000000-0000-0000-0000-000000000000")
        self.assertEqual(
            self.client.get(subscription_url(ghost)).status_code, status.HTTP_404_NOT_FOUND
        )

    def test_platform_support_reads_but_cannot_change(self) -> None:
        tenant = make_tenant(status=S.TRIAL)
        services.start_trial(tenant, make_plan(), actor_id=None)
        self.sign_in_as(platform_user("platform_support"))

        self.assertEqual(self.client.get(subscription_url(tenant)).status_code, status.HTTP_200_OK)
        self.assertEqual(
            self.act(tenant, "mark-payment-failed").status_code, status.HTTP_403_FORBIDDEN
        )

    def test_reinstate_follows_the_live_subscription(self) -> None:
        tenant = make_tenant(status=S.TRIAL)
        live_on(tenant, make_plan())
        self.client.post(tenant_url(tenant, ":suspend"), {"reason": "audit"}, format="json")

        response = self.client.post(tenant_url(tenant, ":reinstate"), {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertEqual(response.json()["data"]["status"], S.ACTIVE)


class ProvisionWithPlanTests(PlatformAPITestCase):
    @override_settings(PLATFORM_DEFAULT_TRIAL_DAYS=14)
    def test_provision_with_a_plan_starts_a_trialing_subscription(self) -> None:
        make_plan(code="standard", trial_days=30)
        tenant = make_tenant()
        before = timezone.now()

        first = self.client.post(
            tenant_url(tenant, ":provision"), {"plan_code": "standard"}, format="json"
        )
        second = self.client.post(
            tenant_url(tenant, ":provision"), {"plan_code": "standard"}, format="json"
        )

        self.assertEqual(first.status_code, status.HTTP_200_OK, first.content)
        self.assert_error(second, status.HTTP_409_CONFLICT, "invalid_transition")
        row = reload(tenant)
        self.assertEqual(row.status, S.TRIAL)
        self.assertEqual((row.current_plan, row.subscription_status), ("standard", SUB.TRIALING))
        # The plan's trial length, not the platform default.
        self.assertGreaterEqual(row.trial_ends_at, before + timedelta(days=30))
        (sub,) = subscriptions_of(tenant)
        self.assertEqual(sub.status, SUB.TRIALING)
        self.assertEqual(sub.current_period_end, row.trial_ends_at)


class SchoolSubscriptionViewTests(PlatformAPITestCase):
    def test_school_owner_reads_own_subscription(self) -> None:
        tenant = TenantFactory()
        live_on(tenant, make_plan(code="standard", enabled_modules=[TIMETABLE]))
        owner = UserFactory(tenant=tenant)
        UserRole.objects.create(
            user=owner, role=Role.objects.get(tenant=None, slug=SCHOOL_OWNER), tenant=tenant
        )
        school = APIClient()
        authenticate(school, owner)

        response = school.get("/api/v1/subscription")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        data = response.json()["data"]
        self.assertEqual(data["subscription"]["plan"]["code"], "standard")
        self.assertEqual(data["subscription"]["plan"]["enabled_modules"], [TIMETABLE])
        self.assertEqual(data["tenant_status"], S.ACTIVE)

    def test_a_staff_member_without_the_key_is_403(self) -> None:
        teacher = UserFactory(tenant=TenantFactory())
        grant(teacher, TIMETABLE_VIEW)
        school = APIClient()
        authenticate(school, teacher)

        self.assertEqual(school.get("/api/v1/subscription").status_code, status.HTTP_403_FORBIDDEN)


class PlanFeatureTests(PlatformAPITestCase):
    """Review Focus 4: module access follows a plan or subscription change at once."""

    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        user = UserFactory(tenant=self.tenant)
        grant(user, TIMETABLE_VIEW)
        self.school = APIClient()
        authenticate(self.school, user)

    def rooms(self):
        return self.school.get(ROOMS_URL)

    def test_plan_module_removal_disables_feature(self) -> None:
        plan = make_plan(enabled_modules=[TIMETABLE])
        live_on(self.tenant, plan)
        self.assertEqual(self.rooms().status_code, status.HTTP_200_OK, self.rooms().content)

        edited = self.client.patch(f"{PLANS_URL}/{plan.pk}", {"enabled_modules": []}, format="json")
        self.assertEqual(edited.status_code, status.HTTP_200_OK, edited.content)

        response = self.rooms()
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.json()["error"]["code"], "module_disabled")

    def test_change_plan_refreshes_features(self) -> None:
        live_on(self.tenant, make_plan(code="basic"))
        make_plan(code="premium", enabled_modules=[TIMETABLE])
        self.assertEqual(self.rooms().json()["error"]["code"], "module_disabled")

        response = self.client.post(
            subscription_url(self.tenant, ":change-plan"), {"plan_code": "premium"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertEqual(response.json()["data"]["subscription"]["plan"]["code"], "premium")
        self.assertEqual(self.rooms().status_code, status.HTTP_200_OK)
