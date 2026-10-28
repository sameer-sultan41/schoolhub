"""Lifecycle helpers for BackgroundJob rows.

Kept out of the task bodies so a task only has to call `mark_running` /
`mark_succeeded` / `mark_failed` / `update_progress` and never touches the
model's field bookkeeping directly — the same "services own the rules"
convention as every other app in this codebase.

`mark_running`/`update_progress`/`mark_succeeded`/`mark_failed` each open their
own `tenant_atomic` (core.tenancy.tasks.TenantAwareTask's docstring explains
why) rather than relying on an already-open transaction, so each commits — and
becomes visible to a polling `GET /jobs/{id}` — the moment it returns, and a
worker killed partway through a task still leaves whichever status was last
written durably recorded.
"""

from __future__ import annotations

import logging
import uuid

from celery import Task
from django.db import transaction
from django.utils import timezone
from kombu.exceptions import OperationalError

from core.jobs.models import BackgroundJob, JobStatus
from core.tenancy.context import tenant_atomic

logger = logging.getLogger(__name__)

QUEUE_FAILURE_MESSAGE = "The job could not be queued. Try again."


def create_job(
    *,
    tenant_id: uuid.UUID,
    job_type: str,
    payload: dict,
    actor_id: uuid.UUID,
    idempotency_key: str | None = None,
) -> BackgroundJob:
    return BackgroundJob.objects.create(
        tenant_id=tenant_id,
        job_type=job_type,
        payload=payload,
        idempotency_key=idempotency_key,
        created_by=actor_id,
        updated_by=actor_id,
    )


def enqueue_job(*, job: BackgroundJob, task: Task) -> None:
    """Send `task` for `job` once the caller's transaction commits.

    Sent inside the transaction, a fast worker looks the job up before its row
    commits, raises `DoesNotExist`, and the job stays `queued` forever. The task
    id is chosen here, so it is stored on the job in that same transaction.

    The send happens after the row is durable, so a broker that refuses it can no
    longer roll the job back with the request: the job is marked failed instead,
    which the caller's poll shows, rather than left `queued` with nothing behind it.
    """
    if job.created_by is None:
        raise ValueError("A queued job needs the actor its task runs for.")
    task_id = str(uuid.uuid4())
    job.celery_task_id = task_id
    job.save(update_fields=["celery_task_id", "updated_at"])
    kwargs = {
        "tenant_id": str(job.tenant_id),
        "job_id": str(job.pk),
        "actor_id": str(job.created_by),
    }

    def send() -> None:
        try:
            task.apply_async(kwargs=kwargs, task_id=task_id)
        except OperationalError:
            logger.exception("Could not queue job %s", job.pk)
            mark_failed(job=job, error=QUEUE_FAILURE_MESSAGE)

    transaction.on_commit(send)


def mark_running(*, job: BackgroundJob) -> BackgroundJob:
    with tenant_atomic(job.tenant_id):
        job.status = JobStatus.RUNNING
        job.started_at = timezone.now()
        job.save(update_fields=["status", "started_at", "updated_at"])
    return job


def update_progress(*, job: BackgroundJob, progress: int) -> None:
    with tenant_atomic(job.tenant_id):
        job.progress = max(0, min(100, progress))
        job.save(update_fields=["progress", "updated_at"])


def update_progress_if_due(
    *, job: BackgroundJob, done: int, total: int, last_written: int, min_step: int = 5
) -> int:
    """Write progress only when it moved ``min_step`` points (or the work is done).

    A per-row write is one transaction per row on top of the row's own, which dwarfs
    the work for a many-row import and tells a polling client nothing a 5-point step
    does not. Returns the progress value now on the job, to pass back as
    ``last_written`` on the next call.
    """
    progress = round(done / max(total, 1) * 100)
    if done >= total or progress - last_written >= min_step:
        update_progress(job=job, progress=progress)
        return progress
    return last_written


def mark_succeeded(*, job: BackgroundJob, result: dict) -> BackgroundJob:
    with tenant_atomic(job.tenant_id):
        job.status = JobStatus.SUCCEEDED
        job.progress = 100
        job.result = result
        job.finished_at = timezone.now()
        job.save(update_fields=["status", "progress", "result", "finished_at", "updated_at"])
    return job


def mark_failed(*, job: BackgroundJob, error: str) -> BackgroundJob:
    with tenant_atomic(job.tenant_id):
        job.status = JobStatus.FAILED
        job.error = error
        job.finished_at = timezone.now()
        job.save(update_fields=["status", "error", "finished_at", "updated_at"])
    return job
