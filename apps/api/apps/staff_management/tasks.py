"""Celery tasks for staff-management's background jobs (module doc §16).

Thin by the same convention as views: each task fetches its job row,
delegates the real work to ``services``, and translates the outcome into the
job's status/progress/result — mirrors student_management/tasks.py exactly.
"""

from __future__ import annotations

import base64
import uuid

from celery import shared_task

from core.jobs.models import BackgroundJob
from core.jobs.services import mark_failed, mark_running, mark_succeeded, update_progress
from core.tenancy.context import tenant_atomic
from core.tenancy.tasks import TenantAwareTask


@shared_task(base=TenantAwareTask, bind=True)
def import_staff_task(self, *, tenant_id: str, job_id: str, actor_id: str) -> None:
    from apps.staff_management.services import import_staff_row, parse_import_rows

    with tenant_atomic(uuid.UUID(tenant_id)):
        job = BackgroundJob.objects.get(pk=job_id)
    mark_running(job=job)
    try:
        filename = job.payload["filename"]
        data = base64.b64decode(job.payload["content_base64"])
        rows = parse_import_rows(filename=filename, data=data)

        errors: list[dict[str, str]] = []
        succeeded = 0
        total = len(rows) or 1
        for index, row in enumerate(rows, start=1):
            error = import_staff_row(
                row=row,
                tenant_id=uuid.UUID(tenant_id),
                actor_id=uuid.UUID(actor_id),
            )
            if error:
                errors.append(error)
            else:
                succeeded += 1
            update_progress(job=job, progress=round(index / total * 100))

        mark_succeeded(
            job=job,
            result={
                "total": len(rows),
                "succeeded": succeeded,
                "failed": len(errors),
                "errors": errors,
            },
        )
    except Exception as exc:
        # Deliberately not re-raised — see import_students_task's identical
        # comment: each write above already committed independently, so
        # nothing is left for a re-raise to roll back.
        mark_failed(job=job, error=str(exc))


@shared_task(base=TenantAwareTask, bind=True)
def export_staff_task(self, *, tenant_id: str, job_id: str, actor_id: str) -> None:
    from apps.staff_management.services import build_staff_export_csv
    from core.files.services import create_ready_file

    with tenant_atomic(uuid.UUID(tenant_id)):
        job = BackgroundJob.objects.get(pk=job_id)
    mark_running(job=job)
    try:
        csv_bytes = build_staff_export_csv(tenant_id=uuid.UUID(tenant_id))
        file = create_ready_file(
            tenant_id=uuid.UUID(tenant_id),
            purpose="staff.export",
            original_name="staff-export.csv",
            mime_type="text/csv",
            data=csv_bytes,
            actor_id=uuid.UUID(actor_id),
        )
        mark_succeeded(job=job, result={"result_file_id": str(file.pk)})
    except Exception as exc:
        mark_failed(job=job, error=str(exc))
