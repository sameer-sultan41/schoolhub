"""Celery tasks for academics' background jobs (module doc §7.2, §16).

Thin by the same convention as views: the task fetches its job row, delegates the
real work to `services`, and translates the outcome into the job's
status/progress/result.

`:execute` is here rather than in the request specifically because
`execute_batch` commits per student. `core.tenancy.context.tenant_atomic` — which
that per-student commit is built on — only opens a real top-level transaction
where nothing else has one open, and `ATOMIC_REQUESTS` means a DRF request always
does. Run from a worker, each student's `tenant_atomic` is what its docstring
says it is: a unit that commits, and releases its row locks, as soon as it
finishes.
"""

from __future__ import annotations

import uuid

from celery import shared_task

from core.jobs.models import BackgroundJob
from core.jobs.services import mark_failed, mark_running, mark_succeeded, update_progress
from core.tenancy.context import tenant_atomic
from core.tenancy.tasks import TenantAwareTask


@shared_task(base=TenantAwareTask, bind=True)
def execute_promotion_batch_task(self, *, tenant_id: str, job_id: str, actor_id: str) -> None:
    from apps.academics.services import execute_batch

    with tenant_atomic(uuid.UUID(tenant_id)):
        job = BackgroundJob.objects.get(pk=job_id)
    mark_running(job=job)
    try:
        report = execute_batch(
            batch_id=uuid.UUID(job.payload["batch_id"]),
            tenant_id=uuid.UUID(tenant_id),
            actor_id=uuid.UUID(actor_id),
            on_progress=lambda progress: update_progress(job=job, progress=progress),
        )
        # Succeeded even with rows in `report["failed"]`: §7.2 asks for a
        # per-student result report, and a batch where 2 of 30 students lacked a
        # guardian did the work it could. `failed` on the job itself is reserved
        # for the batch never having run — a bad id, a lost tenant context.
        mark_succeeded(job=job, result=report)
    except Exception as exc:
        # Deliberately not re-raised — see
        # apps.student_management.tasks.import_students_task's identical comment.
        mark_failed(job=job, error=str(exc))
