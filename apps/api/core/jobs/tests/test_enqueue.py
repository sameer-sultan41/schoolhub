"""`enqueue_job` sends a job's task only after the job row commits."""

from __future__ import annotations

import uuid
from unittest import mock

from django.db import transaction
from django.test import TestCase
from kombu.exceptions import OperationalError

from apps.school_organization.tests.factories import TenantFactory
from core.jobs.models import BackgroundJob, JobStatus
from core.jobs.services import QUEUE_FAILURE_MESSAGE, enqueue_job
from core.jobs.tests.factories import BackgroundJobFactory
from core.tenancy.context import tenant_context


class EnqueueJobTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.actor_id = uuid.uuid4()
        self.task = mock.Mock()

    def _enqueue(self) -> BackgroundJob:
        with tenant_context(self.tenant.id):
            job = BackgroundJobFactory(tenant=self.tenant, created_by=self.actor_id)
            enqueue_job(job=job, task=self.task)
        return job

    def test_nothing_is_sent_until_the_transaction_commits(self) -> None:
        """Root cause of promotion execute's stuck jobs: the worker saw the task first."""
        with self.captureOnCommitCallbacks() as callbacks:
            job = self._enqueue()
            self.task.apply_async.assert_not_called()

        for callback in callbacks:
            callback()

        self.task.apply_async.assert_called_once_with(
            kwargs={
                "tenant_id": str(self.tenant.pk),
                "job_id": str(job.pk),
                "actor_id": str(self.actor_id),
            },
            task_id=job.celery_task_id,
        )

    def test_the_task_id_is_stored_on_the_job_before_the_send(self) -> None:
        with self.captureOnCommitCallbacks():
            job = self._enqueue()

        with tenant_context(self.tenant.id):
            stored = BackgroundJob.objects.get(pk=job.pk).celery_task_id
        self.assertIsNotNone(stored)
        self.assertEqual(stored, job.celery_task_id)

    def test_a_rolled_back_transaction_sends_nothing(self) -> None:
        """A request that fails after queueing leaves no task for a job that never existed."""
        with (
            self.captureOnCommitCallbacks(execute=True) as callbacks,
            self.assertRaises(RuntimeError),
            transaction.atomic(),
        ):
            self._enqueue()
            raise RuntimeError("the request failed after queueing")

        self.assertEqual(callbacks, [])
        self.task.apply_async.assert_not_called()

    def test_a_broker_that_refuses_the_send_fails_the_job_instead_of_leaving_it_queued(
        self,
    ) -> None:
        """The row is durable before the send now, so a refused send cannot roll it back."""
        self.task.apply_async.side_effect = OperationalError("broker unreachable")

        with (
            self.assertLogs("core.jobs.services", level="ERROR"),
            self.captureOnCommitCallbacks(execute=True),
        ):
            job = self._enqueue()

        with tenant_context(self.tenant.id):
            stored = BackgroundJob.objects.get(pk=job.pk)
        self.assertEqual(stored.status, JobStatus.FAILED)
        self.assertEqual(stored.error, QUEUE_FAILURE_MESSAGE)

    def test_a_job_without_an_actor_is_refused(self) -> None:
        with tenant_context(self.tenant.id):
            job = BackgroundJobFactory(tenant=self.tenant, created_by=None)
            with self.assertRaises(ValueError):
                enqueue_job(job=job, task=self.task)
        self.task.apply_async.assert_not_called()
