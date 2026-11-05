"""Row locks that keep invitations and reset links single-use under concurrency (L30).

`TransactionTestCase`, as in `core/jobs/tests/test_claim.py`: each race holds a real
transaction open on this connection while a second thread's call runs on its own, and
`pg_locks` shows when that second call is waiting.

What fails without the lock differs per test. Without `create_invitation`'s user-row lock the
second invite waits on nothing, so the "returned without waiting" assertion fails. Without
reset confirm's `select_for_update` the second confirm still waits, on the first's UPDATE of
the user row, then overwrites the password once it commits; that test is guarded by its
outcome assertion (`InvalidLink`, first password kept), not by the wait.
"""

from __future__ import annotations

import time
from concurrent.futures import Future, ThreadPoolExecutor

from django.db import connection, connections
from django.test import TransactionTestCase
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from apps.school_organization.tests.factories import TenantFactory, UserFactory
from core.api.exceptions import InvalidLink
from core.rbac.invitations.services import create_invitation
from core.rbac.models import Invitation, User
from core.rbac.password_reset.services import confirm_password_reset
from core.rbac.password_reset.tokens import reset_token_generator
from core.rbac.tests.link_helpers import invited_user
from core.tenancy.context import tenant_atomic

LOCK_WAIT_SECONDS = 10
LOCK_POLL_SECONDS = 0.05


class ConcurrentWriteTests(TransactionTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()

    def wait_until_blocked(self, contending: Future) -> None:
        """Poll `pg_locks` until some backend waits on a lock, i.e. the contender is blocked.

        It does not say which lock: a contender blocked on a plain UPDATE passes too, so a
        test whose unlocked version would also wait needs its own outcome assertion.
        """
        deadline = time.monotonic() + LOCK_WAIT_SECONDS
        while time.monotonic() < deadline:
            with connection.cursor() as cursor:
                cursor.execute("SELECT count(*) FROM pg_locks WHERE NOT granted")
                (waiting,) = cursor.fetchone()
            if waiting:
                return
            self.assertFalse(contending.done(), "the contending call returned without waiting")
            time.sleep(LOCK_POLL_SECONDS)
        self.fail("the contending call never waited on the row lock")

    def test_concurrent_invites_leave_one_pending_invitation(self) -> None:
        user = invited_user(self.tenant)

        def contender() -> None:
            try:
                with tenant_atomic(self.tenant.id):
                    create_invitation(
                        user=User.objects.get(pk=user.pk), kind="staff", actor_id=None
                    )
            finally:
                connections.close_all()  # this thread's own connection

        with ThreadPoolExecutor(max_workers=1) as pool:
            with tenant_atomic(self.tenant.id):
                create_invitation(user=user, kind="staff", actor_id=None)
                contending = pool.submit(contender)
                self.wait_until_blocked(contending)
            contending.result(timeout=LOCK_WAIT_SECONDS)

        with tenant_atomic(self.tenant.id):
            pending = Invitation.objects.filter(
                user=user, accepted_at__isnull=True, revoked_at__isnull=True
            ).count()
        self.assertEqual(pending, 1)

    def test_concurrent_reset_confirms_spend_the_link_once(self) -> None:
        user = UserFactory(tenant=self.tenant)
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = reset_token_generator.make_token(user)

        def contender() -> type[Exception] | None:
            try:
                with tenant_atomic(self.tenant.id):
                    confirm_password_reset(
                        tenant=self.tenant,
                        uid=uid,
                        token=token,
                        new_password="test-password-second-24680",
                    )
                return None
            except InvalidLink:
                return InvalidLink
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with tenant_atomic(self.tenant.id):
                confirm_password_reset(
                    tenant=self.tenant,
                    uid=uid,
                    token=token,
                    new_password="test-password-first-13579",
                )
                contending = pool.submit(contender)
                self.wait_until_blocked(contending)
            outcome = contending.result(timeout=LOCK_WAIT_SECONDS)

        self.assertIs(outcome, InvalidLink)
        user.refresh_from_db()
        self.assertTrue(user.check_password("test-password-first-13579"))
