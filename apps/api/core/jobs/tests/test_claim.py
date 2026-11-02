"""`claim_queued_job` — the compare-and-set that lets only one delivery run a job.

`TransactionTestCase`, as in test_job_progress_visibility.py: the claim must bind
the tenant itself, and a `TestCase`'s one wrapping transaction would hide a claim
that did not (RLS makes the unmatched UPDATE look like "already claimed"). It is
also what lets the race test hold a real transaction open across two connections.
"""

from __future__ import annotations

import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor

from django.db import connection, connections
from django.test import TransactionTestCase

from apps.school_organization.tests.factories import TenantFactory, UserFactory
from core.jobs.models import BackgroundJob, JobStatus
from core.jobs.services import claim_queued_job, create_job
from core.tenancy.context import tenant_atomic

# A row-lock wait starts within milliseconds on a local database; the bound only
# stops a broken claim from hanging the suite.
LOCK_WAIT_SECONDS = 10
LOCK_POLL_SECONDS = 0.05


class ClaimQueuedJobTests(TransactionTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        with tenant_atomic(self.tenant.id):
            self.user = UserFactory(tenant=self.tenant)
        self.job = self.make_job(self.tenant.id, self.user.pk)

    @staticmethod
    def make_job(tenant_id: uuid.UUID, actor_id: uuid.UUID) -> BackgroundJob:
        with tenant_atomic(tenant_id):
            return create_job(
                tenant_id=tenant_id, job_type="import.students", payload={}, actor_id=actor_id
            )

    def reload(self, job: BackgroundJob) -> BackgroundJob:
        with tenant_atomic(job.tenant_id):
            return BackgroundJob.objects.get(pk=job.pk)

    def test_a_queued_job_is_claimed_once(self) -> None:
        claimed = claim_queued_job(tenant_id=self.tenant.id, job_id=self.job.pk)

        self.assertIsNotNone(claimed)
        assert claimed is not None
        self.assertEqual(claimed.pk, self.job.pk)
        self.assertEqual(claimed.status, JobStatus.RUNNING)
        self.assertIsNotNone(claimed.started_at)
        reloaded = self.reload(self.job)
        self.assertEqual(reloaded.status, JobStatus.RUNNING)
        self.assertEqual(reloaded.started_at, claimed.started_at)
        # `.update()` skips `auto_now`, so the claim stamps `updated_at` itself.
        self.assertEqual(reloaded.updated_at, claimed.started_at)

    def test_a_second_claim_is_refused_and_leaves_the_first_alone(self) -> None:
        first = claim_queued_job(tenant_id=self.tenant.id, job_id=self.job.pk)
        assert first is not None

        second = claim_queued_job(tenant_id=self.tenant.id, job_id=str(self.job.pk))

        self.assertIsNone(second)
        reloaded = self.reload(self.job)
        self.assertEqual(reloaded.status, JobStatus.RUNNING)
        self.assertEqual(reloaded.started_at, first.started_at)

    def test_a_job_that_is_not_queued_is_not_claimed(self) -> None:
        for status in (JobStatus.RUNNING, JobStatus.SUCCEEDED, JobStatus.FAILED):
            with self.subTest(status=status):
                job = self.make_job(self.tenant.id, self.user.pk)
                with tenant_atomic(self.tenant.id):
                    BackgroundJob.objects.filter(pk=job.pk).update(status=status)

                self.assertIsNone(claim_queued_job(tenant_id=self.tenant.id, job_id=job.pk))
                reloaded = self.reload(job)
                self.assertEqual(reloaded.status, status)
                self.assertIsNone(reloaded.started_at)

    def test_another_tenants_job_is_not_claimed(self) -> None:
        other = TenantFactory()
        with tenant_atomic(other.id):
            other_user = UserFactory(tenant=other)
        foreign = self.make_job(other.id, other_user.pk)

        self.assertIsNone(claim_queued_job(tenant_id=self.tenant.id, job_id=foreign.pk))
        self.assertEqual(self.reload(foreign).status, JobStatus.QUEUED)

    def test_a_claim_racing_an_uncommitted_claim_loses(self) -> None:
        """The race itself, interleaved deterministically on two connections.

        This connection claims the row and holds its transaction open. A second
        thread's `claim_queued_job` then blocks on the row lock; once this
        connection commits, PostgreSQL re-checks the waiting UPDATE's WHERE against
        the committed row, finds it `running`, and updates nothing. A read-then-save
        claim would have read `queued` and won as well.
        """

        def contender() -> BackgroundJob | None:
            try:
                return claim_queued_job(tenant_id=self.tenant.id, job_id=self.job.pk)
            finally:
                connections.close_all()  # this thread's own connection

        with ThreadPoolExecutor(max_workers=1) as pool:
            with tenant_atomic(self.tenant.id):
                queued = BackgroundJob.objects.filter(pk=self.job.pk, status=JobStatus.QUEUED)
                self.assertEqual(queued.update(status=JobStatus.RUNNING), 1)
                contending = pool.submit(contender)
                self.wait_until_blocked(contending)
            # Committed: the waiting UPDATE re-checks the row and matches nothing.
            lost = contending.result(timeout=LOCK_WAIT_SECONDS)

        self.assertIsNone(lost)
        self.assertEqual(self.reload(self.job).status, JobStatus.RUNNING)

    def wait_until_blocked(self, contending: Future) -> None:
        """Poll `pg_locks` until a backend waits on a lock, i.e. the contender is blocked."""
        deadline = time.monotonic() + LOCK_WAIT_SECONDS
        while time.monotonic() < deadline:
            with connection.cursor() as cursor:
                cursor.execute("SELECT count(*) FROM pg_locks WHERE NOT granted")
                (waiting,) = cursor.fetchone()
            if waiting:
                return
            self.assertFalse(contending.done(), "the contending claim returned without waiting")
            time.sleep(LOCK_POLL_SECONDS)
        self.fail("the contending claim never waited on the row lock")
