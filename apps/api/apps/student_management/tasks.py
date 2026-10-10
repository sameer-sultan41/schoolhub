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

from apps.school_organization.services import campuses_by_code
from core.imports.tabular import parse_rows
from core.jobs.models import BackgroundJob
from core.jobs.services import mark_failed, mark_running, mark_succeeded, update_progress_if_due
from core.tenancy.context import tenant_atomic
from core.tenancy.tasks import TenantAwareTask


@shared_task(base=TenantAwareTask, bind=True)
def import_students_task(self, *, tenant_id: str, job_id: str, actor_id: str) -> None:
    from apps.student_management.services import REQUIRED_IMPORT_COLUMNS, import_student_row

    with tenant_atomic(uuid.UUID(tenant_id)):
        job = BackgroundJob.objects.get(pk=job_id)
    mark_running(job=job)
    try:
        filename = job.payload["filename"]
        data = base64.b64decode(job.payload["content_base64"])
        rows = parse_rows(filename=filename, data=data, required_columns=REQUIRED_IMPORT_COLUMNS)

        campuses = campuses_by_code(
            (row["campus_code"] for row in rows if row.get("campus_code")),
            tenant_id=uuid.UUID(tenant_id),
        )
        errors: list[dict[str, str]] = []
        succeeded = 0
        last_progress = 0
        for index, row in enumerate(rows, start=1):
            error = import_student_row(
                row=row,
                tenant_id=uuid.UUID(tenant_id),
                actor_id=uuid.UUID(actor_id),
                campuses_by_code=campuses,
            )
            if error:
                errors.append(error)
            else:
                succeeded += 1
            last_progress = update_progress_if_due(
                job=job, done=index, total=len(rows), last_written=last_progress
            )

        mark_succeeded(
            job=job,
            result={
                "total": len(rows),
                "succeeded": succeeded,
                "failed": len(errors),
                "errors": errors,
            },
        )
    except Exception as exc:  # noqa: BLE001
        # Deliberately not re-raised: each of import_student_row/update_progress/
        # mark_*'s writes above already committed independently in its own
        # tenant_atomic (core.tenancy.tasks.TenantAwareTask's docstring explains
        # why this task holds no single transaction open across its whole body),
        # so there is nothing left for a re-raise to roll back — it would only
        # discard this mark_failed() write too. The client's only failure signal
        # is BackgroundJob.status/.error (polled via GET /jobs/{id}); nothing
        # here relies on Celery's own retry/failure tracking.
        mark_failed(job=job, error=str(exc))


@shared_task(base=TenantAwareTask, bind=True)
def export_students_task(self, *, tenant_id: str, job_id: str, actor_id: str) -> None:
    from apps.student_management.services import build_student_export_csv
    from core.files.services import create_ready_file

    with tenant_atomic(uuid.UUID(tenant_id)):
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
    except Exception as exc:  # noqa: BLE001
        # See import_students_task's matching comment above.
        mark_failed(job=job, error=str(exc))


@shared_task(base=TenantAwareTask, bind=True)
def generate_id_cards_task(self, *, tenant_id: str, job_id: str, actor_id: str) -> None:
    from apps.student_management.services import render_id_cards_pdf
    from core.files.services import create_ready_file

    with tenant_atomic(uuid.UUID(tenant_id)):
        job = BackgroundJob.objects.get(pk=job_id)
    mark_running(job=job)
    try:
        student_ids = [uuid.UUID(value) for value in job.payload["student_ids"]]
        pdf_bytes, rendered_count = render_id_cards_pdf(
            student_ids=student_ids, tenant_id=uuid.UUID(tenant_id)
        )
        file = create_ready_file(
            tenant_id=uuid.UUID(tenant_id),
            purpose="student.id-card-batch",
            original_name="id-cards.pdf",
            mime_type="application/pdf",
            data=pdf_bytes,
            actor_id=uuid.UUID(actor_id),
        )
        mark_succeeded(job=job, result={"result_file_id": str(file.pk), "count": rendered_count})
    except Exception as exc:  # noqa: BLE001
        # See import_students_task's matching comment above.
        mark_failed(job=job, error=str(exc))
