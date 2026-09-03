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

import uuid

from django.utils import timezone

from core.jobs.models import BackgroundJob, JobStatus
from core.tenancy.context import tenant_atomic


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


def attach_celery_task_id(*, job: BackgroundJob, celery_task_id: str) -> None:
    job.celery_task_id = celery_task_id
    job.save(update_fields=["celery_task_id", "updated_at"])


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
