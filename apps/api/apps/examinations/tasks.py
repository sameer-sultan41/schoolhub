"""Background work for the examinations module.

§16 makes admit-card issue a 202 + job, and api-architecture.md §2.7 is the
reason: a hall's worth of PDFs is not work an exam clerk should hold a request
open for, and WeasyPrint is the slowest thing on the platform by a wide margin.

Every job-backed task here follows the shape `attendance.tasks` established —
`mark_running` → try → `mark_succeeded`, `except` → `mark_failed` and **never
re-raise**. The job row is the only place a caller polling `GET /jobs/{id}` can
learn a job failed, so a propagated exception would leave them watching a job
that is stuck at `running` forever.
"""

from __future__ import annotations

import logging
import uuid

from celery import shared_task
from django.utils import timezone

from core.jobs.models import BackgroundJob
from core.jobs.services import mark_failed, mark_running, mark_succeeded, update_progress
from core.tenancy.tasks import TenantAwareTask

logger = logging.getLogger(__name__)

# How often to report progress back to the job row. A batch is hundreds of
# renders and a caller is watching a bar; every row would be a write per PDF.
PROGRESS_EVERY = 25


@shared_task(base=TenantAwareTask, bind=True)
def render_admit_cards_task(self, *, tenant_id: str, job_id: str, actor_id: str) -> None:
    """Render a PDF for every admit card of one exam that has none yet.

    **Rows first, documents second.** `services.issue_admit_cards` has already
    created the `admit_cards` rows synchronously, so a caller sees its numbers
    immediately and this only fills in the files. That split is what makes the
    job re-runnable: it renders whatever has no `file_id`, so a partial failure
    is fixed by running it again rather than by unpicking half a batch.

    One document per card, deliberately, rather than one merged PDF: a card is
    carried into a hall by one student, and `admit_cards.file_id` is a per-row
    column. The ID-card renderer in `student_management` merges because a
    registrar prints a sheet of them at once, which is the opposite need.

    A **revoked** card is skipped. Rendering one would put a downloadable
    document behind a card someone deliberately withdrew.
    """
    from apps.examinations import documents, uploads
    from apps.examinations.models import AdmitCard, AdmitCardStatus, Exam
    from apps.examinations.services import student_sittings
    from core.documents import render_pdf
    from core.files.services import create_ready_file
    from core.tenancy.context import tenant_atomic
    from core.tenancy.models import Tenant

    with tenant_atomic(uuid.UUID(tenant_id)):
        job = BackgroundJob.objects.get(pk=job_id)
    mark_running(job=job)

    rendered = 0
    failed: list[dict[str, str]] = []
    try:
        with tenant_atomic(uuid.UUID(tenant_id)):
            exam = Exam.objects.alive().get(pk=job.payload["exam_id"])
            school_name = Tenant.objects.get(pk=tenant_id).name
            cards = list(
                AdmitCard.objects.alive()
                .filter(exam=exam, file__isnull=True)
                .exclude(status=AdmitCardStatus.REVOKED)
                .select_related("student")
            )

        total = len(cards) or 1
        for index, card in enumerate(cards, start=1):
            try:
                with tenant_atomic(uuid.UUID(tenant_id)):
                    sittings = student_sittings(exam=exam, student=card.student)
                    document = documents.admit_card_html(
                        card=card,
                        exam=exam,
                        student=card.student,
                        sittings=sittings,
                        school_name=school_name,
                    )
                    file = create_ready_file(
                        tenant_id=uuid.UUID(tenant_id),
                        purpose=uploads.ADMIT_CARD.key,
                        original_name=f"admit-card-{card.admit_card_no}.pdf",
                        mime_type="application/pdf",
                        data=render_pdf(document),
                        actor_id=uuid.UUID(actor_id),
                    )
                    card.file = file
                    card.status = AdmitCardStatus.ISSUED
                    card.issued_by = uuid.UUID(actor_id)
                    card.issued_at = timezone.now()
                    card.updated_by = uuid.UUID(actor_id)
                    card.save(
                        update_fields=[
                            "file",
                            "status",
                            "issued_by",
                            "issued_at",
                            "updated_by",
                            "updated_at",
                        ]
                    )
                rendered += 1
            except Exception as exc:
                # One card failing must not cost the other three hundred theirs.
                # The card keeps `generated` with no file, so a re-run picks it
                # up — which is the whole reason this task is idempotent.
                logger.exception("admit card %s failed to render", card.admit_card_no)
                failed.append({"admit_card_no": card.admit_card_no, "error": str(exc)})

            if index % PROGRESS_EVERY == 0:
                update_progress(job=job, progress=int(index / total * 100))

        mark_succeeded(
            job=job,
            result={"rendered": rendered, "failed": failed, "cards": len(cards)},
        )
    except Exception as exc:
        mark_failed(job=job, error=str(exc))


@shared_task(base=TenantAwareTask)
def notify_schedule_published(*, tenant_id: str, exam_id: str) -> dict[str, int]:
    """§12's schedule-published announcement, to students and their guardians.

    **One `notify()` call with the whole recipient list**, not one per student.
    `core.notifications.services.notify` persists a fan-out in two bulk writes
    for the entire list, and its own docstring gives the reason: a class of
    forty guardians was eighty round trips before it did.

    Recipients are the students actually scheduled to sit the exam, plus
    guardians holding a live, portal-enabled link — the same gate
    `Student.filter_owned_by_user` uses for a guardian's read access, so a
    guardian whose access was revoked stops hearing about their child's exams.
    """
    from apps.examinations import notifications
    from apps.examinations.models import Exam
    from apps.examinations.services import admit_card_candidates
    from apps.student_management.models import StudentGuardian
    from core.notifications.services import Recipient, notify
    from core.tenancy.context import tenant_atomic
    from core.tenancy.models import Tenant

    with tenant_atomic(uuid.UUID(tenant_id)):
        exam = Exam.objects.alive().filter(pk=exam_id).first()
        if exam is None:
            return {"notified": 0}
        school_name = Tenant.objects.get(pk=tenant_id).name
        students = admit_card_candidates(exam=exam)
        student_user_ids = [student.user_id for student in students if student.user_id is not None]
        guardian_user_ids = list(
            StudentGuardian.objects.alive()
            .filter(
                student__in=students,
                has_portal_access=True,
                guardian__deleted_at__isnull=True,
                guardian__user_id__isnull=False,
            )
            .values_list("guardian__user_id", flat=True)
        )

        recipients = [
            Recipient(user_id=user_id)
            for user_id in dict.fromkeys([*student_user_ids, *guardian_user_ids])
        ]
        if not recipients:
            # Not an error: a school whose students have no portal accounts yet
            # is an ordinary state, and §12 names no fallback recipient.
            return {"notified": 0}

        try:
            notify(
                notifications.SCHEDULE_PUBLISHED,
                tenant_id=uuid.UUID(tenant_id),
                recipients=recipients,
                context={
                    "exam.name": exam.name,
                    "school.name": school_name,
                    "starts_on": exam.starts_on.isoformat() if exam.starts_on else "shortly",
                },
                source_type="exams",
                source_id=exam.pk,
            )
        except Exception:
            # The schedule is published either way — that is the fact of the
            # matter, and a failed announcement must not undo it.
            logger.exception("%s failed for exam %s", notifications.SCHEDULE_PUBLISHED, exam.pk)
            return {"notified": 0}

    return {"notified": len(recipients)}
