"""The tenant lifecycle state machine (platform-admin.md §7, multi-tenancy.md §7)."""

from __future__ import annotations

import itertools
import uuid
from datetime import timedelta
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.platform_admin import notifications
from apps.platform_admin.tenants import lifecycle
from apps.platform_admin.tests.base import make_tenant
from core.audit.models import AuditLog
from core.notifications.models import Notification
from core.rbac.models import Role, User, UserRole
from core.rbac.roles import SCHOOL_OWNER
from core.tenancy.context import tenant_context
from core.tenancy.models import TenantStatus

S = TenantStatus

# The plan's Global Constraints table, verbatim: these edges and no others.
ALLOWED = {
    (S.PROVISIONING, S.TRIAL),
    (S.PROVISIONING, S.DEPROVISIONED),
    (S.TRIAL, S.ACTIVE),
    (S.ACTIVE, S.PAST_DUE),
    (S.PAST_DUE, S.ACTIVE),
    (S.PAST_DUE, S.SUSPENDED),
    (S.TRIAL, S.SUSPENDED),
    (S.ACTIVE, S.SUSPENDED),
    (S.SUSPENDED, S.ACTIVE),
    (S.SUSPENDED, S.PAST_DUE),
    (S.SUSPENDED, S.TRIAL),
    (S.ACTIVE, S.DEPROVISIONED),
    (S.SUSPENDED, S.DEPROVISIONED),
    (S.DEPROVISIONED, S.SUSPENDED),
}


def owner_of(tenant) -> User:
    """An active login holding the shared `school_owner` default role at ``tenant``."""
    user = User.objects.create_user(
        f"owner-{tenant.slug}@school.test", "x-owner-pass-1", tenant=tenant, is_active=True
    )
    UserRole.objects.create(
        user=user, role=Role.objects.get(tenant=None, slug=SCHOOL_OWNER), tenant=tenant
    )
    return user


class TransitionTests(TestCase):
    def test_every_transition_pair(self) -> None:
        for source, target in itertools.product(S.values, repeat=2):
            with self.subTest(source=source, target=target):
                tenant = make_tenant(
                    status=source,
                    # Restoring is allowed only inside the retention window.
                    deprovision_after=timezone.now() + timedelta(days=1),
                )
                if (source, target) in ALLOWED:
                    moved = lifecycle.transition(tenant, target, actor_id=None, reason="test")
                    self.assertEqual(moved.status, target)
                    tenant.refresh_from_db()
                    self.assertEqual(tenant.status, target)
                else:
                    with self.assertRaises(lifecycle.InvalidTransition):
                        lifecycle.transition(tenant, target, actor_id=None, reason="test")
                    tenant.refresh_from_db()
                    self.assertEqual(tenant.status, source)

    def test_the_table_is_exactly_the_allowed_edges(self) -> None:
        declared = {
            (source, target)
            for source, targets in lifecycle.ALLOWED_TRANSITIONS.items()
            for target in targets
        }
        self.assertEqual(declared, ALLOWED)

    def test_suspend_stamps_suspended_at_and_reinstate_clears_it(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)

        lifecycle.transition(tenant, S.SUSPENDED, actor_id=None, reason="ToS")
        tenant.refresh_from_db()
        self.assertIsNotNone(tenant.suspended_at)

        lifecycle.transition(tenant, S.ACTIVE, actor_id=None)
        tenant.refresh_from_db()
        self.assertIsNone(tenant.suspended_at)

    @override_settings(PLATFORM_RETENTION_DAYS=90)
    def test_delete_starts_the_retention_window(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)
        before = timezone.now()

        lifecycle.transition(tenant, S.DEPROVISIONED, actor_id=None, reason="closing")

        tenant.refresh_from_db()
        self.assertGreaterEqual(tenant.deprovision_after, before + timedelta(days=90))
        self.assertLessEqual(tenant.deprovision_after, timezone.now() + timedelta(days=90))

    def test_restore_only_within_retention(self) -> None:
        expired = make_tenant(
            status=S.DEPROVISIONED, deprovision_after=timezone.now() - timedelta(seconds=1)
        )
        with self.assertRaises(lifecycle.RetentionExpired):
            lifecycle.transition(expired, S.SUSPENDED, actor_id=None, reason="restore")
        expired.refresh_from_db()
        self.assertEqual(expired.status, S.DEPROVISIONED)

        live = make_tenant(
            status=S.DEPROVISIONED, deprovision_after=timezone.now() + timedelta(days=3)
        )
        lifecycle.transition(live, S.SUSPENDED, actor_id=None, reason="restore")
        live.refresh_from_db()
        self.assertEqual(live.status, S.SUSPENDED)
        self.assertIsNone(live.deprovision_after)

    def test_restore_stamps_suspended_at_when_the_school_was_never_suspended(self) -> None:
        # Provisioning and active schools are deleted without a suspension first.
        tenant = make_tenant(
            status=S.DEPROVISIONED,
            suspended_at=None,
            deprovision_after=timezone.now() + timedelta(days=3),
        )
        before = timezone.now()

        lifecycle.transition(tenant, S.SUSPENDED, actor_id=None, reason="restore")

        tenant.refresh_from_db()
        self.assertGreaterEqual(tenant.suspended_at, before)

    def test_restore_keeps_the_original_suspension_time(self) -> None:
        suspended_at = timezone.now() - timedelta(days=10)
        tenant = make_tenant(
            status=S.DEPROVISIONED,
            suspended_at=suspended_at,
            deprovision_after=timezone.now() + timedelta(days=3),
        )

        lifecycle.transition(tenant, S.SUSPENDED, actor_id=None, reason="restore")

        tenant.refresh_from_db()
        self.assertEqual(tenant.suspended_at, suspended_at)

    def test_system_transition_audits_through_record_system_audit(self) -> None:
        tenant = make_tenant(status=S.TRIAL)

        lifecycle.transition(tenant, S.SUSPENDED, actor_id=None, reason="trial expired")

        row = AuditLog.objects.get(resource_id=tenant.pk, action="suspend")
        self.assertIsNone(row.actor_id)
        self.assertEqual(row.tenant_id, tenant.pk)
        self.assertEqual(row.after, {"from": S.TRIAL, "to": S.SUSPENDED, "reason": "trial expired"})

    def test_a_human_transition_leaves_the_audit_to_the_view(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)

        lifecycle.transition(tenant, S.SUSPENDED, actor_id=uuid.uuid4(), reason="ToS")

        self.assertFalse(AuditLog.objects.filter(resource_id=tenant.pk).exists())


class LifecycleNotificationTests(TestCase):
    def owner_notifications(self, tenant, event_key: str) -> list[Notification]:
        with tenant_context(tenant.pk):
            return list(Notification.objects.filter(event_key=event_key))

    def test_suspension_and_reinstatement_notify_the_owner(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)
        owner = owner_of(tenant)

        lifecycle.transition(tenant, S.SUSPENDED, actor_id=None, reason="unpaid")
        suspended = self.owner_notifications(tenant, notifications.TENANT_SUSPENDED)
        self.assertEqual([n.user_id for n in suspended], [owner.pk])

        lifecycle.transition(tenant, S.ACTIVE, actor_id=None)
        reinstated = self.owner_notifications(tenant, notifications.TENANT_REINSTATED)
        self.assertEqual([n.user_id for n in reinstated], [owner.pk])

    def test_restoring_to_suspended_sends_no_suspension_notice(self) -> None:
        tenant = make_tenant(
            status=S.DEPROVISIONED, deprovision_after=timezone.now() + timedelta(days=3)
        )
        owner_of(tenant)

        lifecycle.transition(tenant, S.SUSPENDED, actor_id=None, reason="restore")

        self.assertEqual(self.owner_notifications(tenant, notifications.TENANT_SUSPENDED), [])

    def test_an_owner_whose_role_was_removed_is_not_notified(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)
        owner = owner_of(tenant)
        UserRole.objects.filter(user=owner).update(deleted_at=timezone.now())

        lifecycle.transition(tenant, S.SUSPENDED, actor_id=None, reason="unpaid")

        self.assertEqual(self.owner_notifications(tenant, notifications.TENANT_SUSPENDED), [])

    def test_a_failed_owner_lookup_does_not_undo_the_transition(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)

        with mock.patch.object(notifications, "school_owners", side_effect=RuntimeError("boom")):
            lifecycle.transition(tenant, S.SUSPENDED, actor_id=None, reason="unpaid")

        tenant.refresh_from_db()
        self.assertEqual(tenant.status, S.SUSPENDED)
