"""Two reads that both find the checklist complete (fh-constraints, ruling A9).

`completed_at` is written only by a conditional `UPDATE ... WHERE onboarding->>'completed_at'
IS NULL`. The first read stamps it and holds its transaction open; the second's `UPDATE` waits
on the row, then re-checks its `WHERE` against the committed row, matches nothing, and reads
the first stamp back. An unconditional write would overwrite it with the second, later time.
"""

from __future__ import annotations

import time
from concurrent.futures import Future, ThreadPoolExecutor

from django.db import connection, connections
from django.test import TransactionTestCase
from django.utils import timezone

from apps.platform_admin.onboarding.services import onboarding_progress
from apps.platform_admin.onboarding.tests.test_endpoints import build_setup
from apps.school_organization.models import SessionStatus
from apps.school_organization.tests.factories import TenantFactory
from core.tenancy.context import tenant_atomic
from core.tenancy.models import TenantSettings

LOCK_WAIT_SECONDS = 10
LOCK_POLL_SECONDS = 0.05


class CompletedAtConcurrencyTests(TransactionTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        # `tenant_atomic`, not just the factories' `tenant_context`: a TransactionTestCase runs in
        # autocommit, where `SET LOCAL` outside a transaction binds nothing and RLS refuses.
        with tenant_atomic(self.tenant.id):
            build_setup(self.tenant, session_status=SessionStatus.ACTIVE)
            TenantSettings.objects.create(
                tenant=self.tenant,
                onboarding={"profile_confirmed_at": timezone.now().isoformat()},
            )

    def wait_until_blocked(self, contending: Future) -> None:
        deadline = time.monotonic() + LOCK_WAIT_SECONDS
        while time.monotonic() < deadline:
            with connection.cursor() as cursor:
                cursor.execute("SELECT count(*) FROM pg_locks WHERE NOT granted")
                (waiting,) = cursor.fetchone()
            if waiting:
                return
            self.assertFalse(contending.done(), "the second read returned without waiting")
            time.sleep(LOCK_POLL_SECONDS)
        self.fail("the second read never waited on the settings row")

    def test_completed_at_stamped_once_concurrently(self) -> None:
        def contender() -> dict:
            try:
                with tenant_atomic(self.tenant.id):
                    return onboarding_progress(self.tenant)
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with tenant_atomic(self.tenant.id):
                first = onboarding_progress(self.tenant)
                contending = pool.submit(contender)
                self.wait_until_blocked(contending)
            second = contending.result(timeout=LOCK_WAIT_SECONDS)

        self.assertTrue(first["completed"])
        self.assertTrue(second["completed"])
        self.assertIsNotNone(first["completed_at"])
        self.assertEqual(second["completed_at"], first["completed_at"])
        with tenant_atomic(self.tenant.id):
            stored = TenantSettings.objects.get(tenant=self.tenant).onboarding
        self.assertEqual(stored["completed_at"], first["completed_at"])
        self.assertIn("profile_confirmed_at", stored)
