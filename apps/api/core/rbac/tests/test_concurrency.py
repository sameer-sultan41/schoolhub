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
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from apps.school_organization.tests.factories import TenantFactory, UserFactory
from core.api.exceptions import InvalidLink
from core.rbac.invitations.exceptions import AlreadyActive
from core.rbac.invitations.services import (
    INVITATION_TTL,
    accept_invitation,
    create_invitation,
    hash_token,
    readdress_pending_account,
)
from core.rbac.models import Invitation, User
from core.rbac.password_reset.services import confirm_password_reset
from core.rbac.password_reset.tokens import reset_token_generator
from core.rbac.tests.link_helpers import invited_user, without_app_eligibility_hooks
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

    def test_resend_racing_an_accept_never_readdresses_the_activated_account(self) -> None:
        """A resend that read the account before an accept committed must not move its login.

        Guarded by the outcome, not the wait: without the lock the resend still waits, on
        the accept's UPDATE of the user row, then overwrites the email and issues a new link.
        """
        without_app_eligibility_hooks(self)
        raw = "race-accept-token"
        user = invited_user(self.tenant, email="original@example.test")
        with tenant_atomic(self.tenant.id):
            Invitation.objects.create(
                tenant=self.tenant,
                user=user,
                kind="staff",
                token_hash=hash_token(raw),
                sent_at=timezone.now(),
                expires_at=timezone.now() + INVITATION_TTL,
            )

        def resend() -> type[Exception] | None:
            try:
                with tenant_atomic(self.tenant.id):
                    stale = User.objects.get(pk=user.pk)
                    readdress_pending_account(user=stale, email="corrected@example.test")
                    create_invitation(user=stale, kind="staff", actor_id=None)
                return None
            except AlreadyActive:
                return AlreadyActive
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with tenant_atomic(self.tenant.id):
                accept_invitation(
                    tenant=self.tenant, raw_token=raw, password="test-password-accepted-97531"
                )
                contending = pool.submit(resend)
                self.wait_until_blocked(contending)
            outcome = contending.result(timeout=LOCK_WAIT_SECONDS)

        self.assertIs(outcome, AlreadyActive)
        user.refresh_from_db()
        self.assertTrue(user.is_active)
        self.assertEqual(user.email, "original@example.test")
        with tenant_atomic(self.tenant.id):
            pending = Invitation.objects.filter(
                user=user, accepted_at__isnull=True, revoked_at__isnull=True
            ).count()
        self.assertEqual(pending, 0)

    def test_same_address_resend_racing_an_accept_issues_no_link(self) -> None:
        """A resend with nothing to re-address still must not invite a just-activated account.

        Guarded by the outcome: without `create_invitation`'s locked re-read the resend still
        waits, on the user-row lock the accept holds, then creates a live pending link.
        """
        without_app_eligibility_hooks(self)
        raw = "race-same-address-token"
        user = invited_user(self.tenant, email="same@example.test")
        with tenant_atomic(self.tenant.id):
            Invitation.objects.create(
                tenant=self.tenant,
                user=user,
                kind="staff",
                token_hash=hash_token(raw),
                sent_at=timezone.now(),
                expires_at=timezone.now() + INVITATION_TTL,
            )

        def resend() -> type[Exception] | None:
            try:
                with tenant_atomic(self.tenant.id):
                    stale = User.objects.get(pk=user.pk)
                    readdress_pending_account(user=stale, email="same@example.test")
                    create_invitation(user=stale, kind="staff", actor_id=None)
                return None
            except AlreadyActive:
                return AlreadyActive
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with tenant_atomic(self.tenant.id):
                accept_invitation(
                    tenant=self.tenant, raw_token=raw, password="test-password-accepted-86420"
                )
                contending = pool.submit(resend)
                self.wait_until_blocked(contending)
            outcome = contending.result(timeout=LOCK_WAIT_SECONDS)

        self.assertIs(outcome, AlreadyActive)
        user.refresh_from_db()
        self.assertTrue(user.is_active)
        with tenant_atomic(self.tenant.id):
            pending = Invitation.objects.filter(
                user=user, accepted_at__isnull=True, revoked_at__isnull=True
            ).count()
        self.assertEqual(pending, 0)
