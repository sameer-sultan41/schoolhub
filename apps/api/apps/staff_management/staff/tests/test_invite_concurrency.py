"""Two `:invite`s for one staff member at once (L30), as `core/rbac/tests/test_concurrency.py`.

The first holds its transaction open after creating the account; the second must wait on
the staff row lock, then find that account and resend. Without the lock the second reads
no account, passes the email check against uncommitted data, inserts a second user with
the same email, waits on the unique index instead, and is refused (`email_in_use`) once
the first commits.
"""

from __future__ import annotations

import time
from concurrent.futures import Future, ThreadPoolExecutor

from django.db import connection, connections
from django.test import TransactionTestCase, override_settings

from apps.school_organization.tests.factories import CampusFactory, TenantFactory, UserFactory
from apps.staff_management.models import Staff
from apps.staff_management.staff.services.invite import invite_staff
from apps.staff_management.tests.factories import StaffFactory
from core.rbac.models import Invitation, User
from core.rbac.tests.link_helpers import LINK_SETTINGS
from core.tenancy.context import tenant_atomic

LOCK_WAIT_SECONDS = 10
LOCK_POLL_SECONDS = 0.05
EMAIL = "race@example.test"


@override_settings(**LINK_SETTINGS)
class ConcurrentStaffInviteTests(TransactionTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        with tenant_atomic(self.tenant.id):
            self.actor = UserFactory(tenant=self.tenant)
            campus = CampusFactory(tenant=self.tenant)
            self.staff = StaffFactory(tenant=self.tenant, campus=campus, email=EMAIL)

    def wait_until_blocked(self, contending: Future) -> None:
        deadline = time.monotonic() + LOCK_WAIT_SECONDS
        while time.monotonic() < deadline:
            with connection.cursor() as cursor:
                cursor.execute("SELECT count(*) FROM pg_locks WHERE NOT granted")
                (waiting,) = cursor.fetchone()
            if waiting:
                return
            self.assertFalse(contending.done(), "the contending invite returned without waiting")
            time.sleep(LOCK_POLL_SECONDS)
        self.fail("the contending invite never waited on a lock")

    def test_concurrent_staff_invites_create_one_user(self) -> None:
        def contender() -> Staff:
            try:
                with tenant_atomic(self.tenant.id):
                    stale = Staff.objects.get(pk=self.staff.pk)
                    return invite_staff(staff=stale, role_ids=[], actor_id=self.actor.pk)
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with tenant_atomic(self.tenant.id):
                first = invite_staff(staff=self.staff, role_ids=[], actor_id=self.actor.pk)
                contending = pool.submit(contender)
                self.wait_until_blocked(contending)
            second = contending.result(timeout=LOCK_WAIT_SECONDS)

        self.assertEqual(second.user_id, first.user_id)
        self.assertEqual(User.objects.filter(tenant=self.tenant, email=EMAIL).count(), 1)
        with tenant_atomic(self.tenant.id):
            pending = Invitation.objects.filter(
                user_id=first.user_id, accepted_at__isnull=True, revoked_at__isnull=True
            ).count()
        self.assertEqual(pending, 1)
