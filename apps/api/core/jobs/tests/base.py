"""Shared assertions for endpoints that answer `202` + a job."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from unittest import mock

from celery import Task
from django.test import TestCase
from rest_framework import status
from rest_framework.response import Response

from core.jobs.models import BackgroundJob
from core.tenancy.context import tenant_context


def run_on_commit(test: TestCase, send: Callable[[], Response]) -> Response:
    """`send()`, then the commit callbacks it queued, which under eager Celery run the task."""
    with test.captureOnCommitCallbacks(execute=True):
        return send()


def assert_sent_on_commit(
    test: TestCase,
    task: Task,
    send: Callable[[], Response],
    *,
    tenant_id: uuid.UUID,
    actor_id: uuid.UUID,
) -> BackgroundJob:
    """`send()` queues `task` only once the request's transaction commits.

    A task sent inside the transaction can reach a worker before the job row
    exists there (`core.jobs.services.enqueue_job`). Nothing may be sent while the
    request runs; running the captured commit callbacks sends it exactly once,
    under the task id stored on the job.
    """
    with mock.patch.object(task, "apply_async") as apply_async:
        with test.captureOnCommitCallbacks() as callbacks:
            response = send()
        test.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        apply_async.assert_not_called()

        for callback in callbacks:
            callback()

    job_id = response.json()["data"]["job_id"]
    with tenant_context(tenant_id):
        job = BackgroundJob.objects.get(pk=job_id)
    test.assertIsNotNone(job.celery_task_id)
    apply_async.assert_called_once_with(
        kwargs={
            "tenant_id": str(tenant_id),
            "job_id": job_id,
            "actor_id": str(actor_id),
        },
        task_id=job.celery_task_id,
    )
    return job
