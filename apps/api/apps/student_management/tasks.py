"""Celery tasks for student-management's background jobs (module doc §16).

Thin by the same convention as views: each task fetches its job row, delegates
the real work to `services`, and translates the outcome into the job's
status/progress/result — every rule lives in services.py, testable without a
broker.
"""

from __future__ import annotations

import base64
import uuid

from celery import shared_task

from core.jobs.models import BackgroundJob
from core.jobs.services import mark_failed, mark_running, mark_succeeded, update_progress
from core.tenancy.tasks import TenantAwareTask


@shared_task(base=TenantAwareTask, bind=True)
def import_students_task(self, *, tenant_id: str, job_id: str, actor_id: str) -> None:
    from apps.student_management.services import import_student_row, parse_import_rows

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
            # +1 for the header line, so row numbers match what a spreadsheet
            # editor shows.
            error = import_student_row(
                row=row,
                row_number=index + 1,
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
        # Deliberately not re-raised: TenantAwareTask.__call__ wraps this whole
        # body in one transaction.atomic() block, so an exception propagating
        # out of it would roll back the mark_failed() write above along with
        # everything else. The client's only failure signal is BackgroundJob
        # .status/.error (polled via GET /jobs/{id}); nothing here relies on
        # Celery's own retry/failure tracking.
        mark_failed(job=job, error=str(exc))


@shared_task(base=TenantAwareTask, bind=True)
def export_students_task(self, *, tenant_id: str, job_id: str, actor_id: str) -> None:
    from apps.student_management.services import build_student_export_csv
    from core.files.services import create_ready_file

    job = BackgroundJob.objects.get(pk=job_id)
    mark_running(job=job)
    try:
        csv_bytes = build_student_export_csv(tenant_id=uuid.UUID(tenant_id))
        file = create_ready_file(
            tenant_id=uuid.UUID(tenant_id),
            purpose="student.export",
            original_name="students-export.csv",
            mime_type="text/csv",
            data=csv_bytes,
            actor_id=uuid.UUID(actor_id),
        )
        mark_succeeded(job=job, result={"result_file_id": str(file.pk)})
    except Exception as exc:
        # Deliberately not re-raised: TenantAwareTask.__call__ wraps this whole
        # body in one transaction.atomic() block, so an exception propagating
        # out of it would roll back the mark_failed() write above along with
        # everything else. The client's only failure signal is BackgroundJob
        # .status/.error (polled via GET /jobs/{id}); nothing here relies on
        # Celery's own retry/failure tracking.
        mark_failed(job=job, error=str(exc))


@shared_task(base=TenantAwareTask, bind=True)
def generate_id_cards_task(self, *, tenant_id: str, job_id: str, actor_id: str) -> None:
    from apps.student_management.services import render_id_cards_pdf
    from core.files.services import create_ready_file

    job = BackgroundJob.objects.get(pk=job_id)
    mark_running(job=job)
    try:
        student_ids = [uuid.UUID(value) for value in job.payload["student_ids"]]
        pdf_bytes = render_id_cards_pdf(student_ids=student_ids, tenant_id=uuid.UUID(tenant_id))
        file = create_ready_file(
            tenant_id=uuid.UUID(tenant_id),
            purpose="student.id-card-batch",
            original_name="id-cards.pdf",
            mime_type="application/pdf",
            data=pdf_bytes,
            actor_id=uuid.UUID(actor_id),
        )
        mark_succeeded(job=job, result={"result_file_id": str(file.pk), "count": len(student_ids)})
    except Exception as exc:
        # Deliberately not re-raised: TenantAwareTask.__call__ wraps this whole
        # body in one transaction.atomic() block, so an exception propagating
        # out of it would roll back the mark_failed() write above along with
        # everything else. The client's only failure signal is BackgroundJob
        # .status/.error (polled via GET /jobs/{id}); nothing here relies on
        # Celery's own retry/failure tracking.
        mark_failed(job=job, error=str(exc))
