"""The console's beat sweeps: trial reminders and expiry, dunning, and override lapses.

Each picks its candidates from the platform-scope `tenants` table, then works one school at a
time with that school bound. A notice is checked against the school's existing notifications
first, on a key more specific than the school, so a rerun sends nothing twice while a school's
next trial or next period still gets its own notice.
"""

from __future__ import annotations

from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.platform_admin import notifications, tasks
from apps.platform_admin.models import Subscription
from apps.platform_admin.subscriptions import services
from apps.platform_admin.tenants import services as tenant_services
from apps.platform_admin.tests.base import make_plan, make_tenant
from apps.platform_admin.tests.test_lifecycle import owner_of
from apps.platform_admin.tests.test_subscriptions import live_on, reload
from core.audit.models import AuditLog
from core.notifications.models import Notification
from core.tenancy.context import tenant_context
from core.tenancy.models import FeatureFlag, Tenant, TenantFeatureOverride, TenantStatus

S = TenantStatus
GRACE_DAYS = 14


def notices(tenant: Tenant, event_key: str) -> list[Notification]:
    with tenant_context(tenant.pk):
        return list(Notification.objects.filter(event_key=event_key))


def past_due(tenant: Tenant, *, period_ended: timedelta) -> Subscription:
    """``tenant`` past due on a period that ended ``period_ended`` ago."""
    sub = live_on(tenant, make_plan())
    sub = services.mark_payment_failed(sub, actor_id=None)
    with tenant_context(tenant.pk):
        Subscription.objects.filter(pk=sub.pk).update(
            current_period_end=timezone.now() - period_ended
        )
    return sub


@override_settings(PLATFORM_TRIAL_REMINDER_DAYS=(7, 3, 1), PLATFORM_DUNNING_GRACE_DAYS=GRACE_DAYS)
class SweepTests(TestCase):
    def test_trial_reminder_sent_once_per_threshold(self) -> None:
        ends = timezone.now() + timedelta(days=2, hours=12)
        tenant = make_tenant(status=S.TRIAL, trial_ends_at=ends)
        owner = owner_of(tenant)

        tasks.trial_reminders()
        tasks.trial_reminders()

        sent = notices(tenant, notifications.TRIAL_EXPIRING)
        self.assertEqual([n.user_id for n in sent], [owner.pk])
        self.assertIn("3", sent[0].body)

        # The next threshold is a new notice.
        ends = timezone.now() + timedelta(hours=12)
        Tenant.objects.filter(pk=tenant.pk).update(trial_ends_at=ends)
        tasks.trial_reminders()
        tasks.trial_reminders()
        self.assertEqual(len(notices(tenant, notifications.TRIAL_EXPIRING)), 2)

    def test_a_trial_outside_every_threshold_gets_no_reminder(self) -> None:
        far = make_tenant(status=S.TRIAL, trial_ends_at=timezone.now() + timedelta(days=10))
        active = make_tenant(status=S.ACTIVE, trial_ends_at=timezone.now() + timedelta(days=1))
        for tenant in (far, active):
            owner_of(tenant)

        tasks.trial_reminders()

        for tenant in (far, active):
            self.assertEqual(notices(tenant, notifications.TRIAL_EXPIRING), [])

    def test_expired_trial_is_suspended(self) -> None:
        expired = make_tenant(status=S.TRIAL, trial_ends_at=timezone.now() - timedelta(minutes=1))
        running = make_tenant(status=S.TRIAL, trial_ends_at=timezone.now() + timedelta(days=1))

        tasks.expire_trials()

        self.assertEqual(reload(expired).status, S.SUSPENDED)
        self.assertEqual(reload(running).status, S.TRIAL)
        audit = AuditLog.objects.get(resource_id=expired.pk, action="suspend")
        self.assertIsNone(audit.actor_id)

    def test_dunning_suspends_after_grace(self) -> None:
        lapsed = make_tenant(status=S.TRIAL)
        past_due(lapsed, period_ended=timedelta(days=GRACE_DAYS + 1))
        in_grace = make_tenant(status=S.TRIAL)
        owner = owner_of(in_grace)
        past_due(in_grace, period_ended=timedelta(days=GRACE_DAYS - 1))

        tasks.dunning_sweep()
        tasks.dunning_sweep()

        self.assertEqual(reload(lapsed).status, S.SUSPENDED)
        self.assertEqual(reload(in_grace).status, S.PAST_DUE)
        # One payment-failed notice for the period, however often the sweep runs.
        sent = notices(in_grace, notifications.PAYMENT_FAILED)
        self.assertEqual([n.user_id for n in sent], [owner.pk])

    def test_a_school_reinstated_within_grace_is_not_suspended_early(self) -> None:
        tenant = make_tenant(status=S.TRIAL)
        past_due(tenant, period_ended=timedelta(days=GRACE_DAYS - 1))
        with tenant_context(tenant.pk):
            tenant_services.suspend_tenant(reload(tenant), reason="audit", actor_id=None)
            tenant_services.reinstate_tenant(reload(tenant), trial_ends_at=None, actor_id=None)
        self.assertEqual(reload(tenant).status, S.PAST_DUE)

        tasks.dunning_sweep()

        self.assertEqual(reload(tenant).status, S.PAST_DUE)

    def test_expired_override_lapses(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)
        flag = FeatureFlag.objects.get(key="module.timetable")
        with tenant_context(tenant.pk):
            expired = TenantFeatureOverride.objects.create(
                tenant=tenant,
                feature_flag=flag,
                enabled=True,
                reason="pilot",
                expires_at=timezone.now() - timedelta(minutes=1),
            )

        result = tasks.lapse_overrides()

        self.assertGreaterEqual(result["affected"], 1)
        with tenant_context(tenant.pk):
            expired.refresh_from_db()
        self.assertIsNotNone(expired.deleted_at)
        audit = AuditLog.objects.get(resource_id=expired.pk, action="lapse")
        self.assertEqual(audit.tenant_id, tenant.pk)
        self.assertIsNone(audit.actor_id)
