"""`claim_queued_job` — the compare-and-set that lets only one delivery run a job.

`TransactionTestCase`, as in test_job_progress_visibility.py: the claim must bind
the tenant itself, and a `TestCase`'s one wrapping transaction would hide a claim
that did not (RLS makes the unmatched UPDATE look like "already claimed").
"""

from __future__ import annotations

import uuid

from django.db import connection
from django.test import TransactionTestCase
from django.test.utils import CaptureQueriesContext

from apps.school_organization.tests.factories import TenantFactory, UserFactory
from core.jobs.models import BackgroundJob, JobStatus
from core.jobs.services import claim_queued_job, create_job
from core.tenancy.context import tenant_atomic


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

    def test_the_claim_is_one_conditional_update_with_no_read_before_it(self) -> None:
        """No SELECT-then-UPDATE window: the status test is in the UPDATE's own WHERE."""
        with CaptureQueriesContext(connection) as queries:
            claim_queued_job(tenant_id=self.tenant.id, job_id=self.job.pk)

        statements = [query["sql"] for query in queries.captured_queries]
        writes = [sql for sql in statements if sql.startswith("UPDATE")]
        self.assertEqual(len(writes), 1, statements)
        _, where = writes[0].split(" WHERE ", 1)
        self.assertIn('"background_jobs"."status"', where)
        reads_before = [
            sql
            for sql in statements[: statements.index(writes[0])]
            if sql.startswith("SELECT") and "background_jobs" in sql
        ]
        self.assertEqual(reads_before, [])
