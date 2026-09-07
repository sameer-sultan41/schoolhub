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
from core.tenancy.maintenance import for_each_tenant
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
    from apps.examinations.services import sittings_by_student
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
            # Every card's sittings, fetched once. Review found the single-card
            # `student_sittings` being called inside the loop below — two
            # queries per card, so three hundred cards was six hundred round
            # trips. `collect_scope`'s docstring in `conflicts.py` warns against
            # exactly this shape; the same rule applies to a render batch.
            sittings = sittings_by_student(exam=exam, students=[card.student for card in cards])

        total = len(cards) or 1
        for index, card in enumerate(cards, start=1):
            try:
                with tenant_atomic(uuid.UUID(tenant_id)):
                    document = documents.admit_card_html(
                        card=card,
                        exam=exam,
                        student=card.student,
                        sittings=sittings.get(card.student_id, []),
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

        # §12's admit-card announcement, and it goes here rather than beside
        # `issue_admit_cards`: the notification tells a guardian the card is
        # "ready" and downloadable, which is only true once a document exists.
        # Review found it registered with templates, documented as wired, and
        # called from nowhere — a catalogue entry that persisted no rows.
        if rendered:
            notify_admit_cards_issued.delay(tenant_id=tenant_id, exam_id=str(exam.pk))

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


@shared_task(base=TenantAwareTask)
def notify_admit_cards_issued(*, tenant_id: str, exam_id: str) -> dict[str, int]:
    """§12's admit-card announcement, once the documents exist.

    Enqueued by `render_admit_cards_task` rather than by the endpoint, because
    the message says the card is ready to download and that is only true after
    a render. One `notify()` call per recipient list, for the reason
    `notify_schedule_published` gives.

    **Per-recipient context is not attempted.** §12's template names
    `student.first_name` and `admit_card_no`, which differ per card — so this
    sends one message per *card holder* rather than one for the whole exam, and
    the fan-out is a list of one. That is a real cost (a query per card's
    guardians would be worse, so the guardians are fetched once and grouped),
    accepted because a card number in the body is what makes the message
    actionable rather than a notice to go and look.
    """
    from apps.examinations import notifications
    from apps.examinations.models import AdmitCard, AdmitCardStatus, Exam
    from apps.student_management.models import StudentGuardian
    from core.notifications.services import Recipient, notify
    from core.tenancy.context import tenant_atomic
    from core.tenancy.models import Tenant

    sent = 0
    with tenant_atomic(uuid.UUID(tenant_id)):
        exam = Exam.objects.alive().filter(pk=exam_id).first()
        if exam is None:
            return {"notified": 0}
        school_name = Tenant.objects.get(pk=tenant_id).name
        cards = list(
            AdmitCard.objects.alive()
            .filter(exam=exam, status=AdmitCardStatus.ISSUED, file__isnull=False)
            .select_related("student")
        )
        if not cards:
            return {"notified": 0}

        # Guardians for every card holder, in one query and grouped — never one
        # query per card.
        guardians: dict = {}
        links = (
            StudentGuardian.objects.alive()
            .filter(
                student__in=[card.student for card in cards],
                has_portal_access=True,
                guardian__deleted_at__isnull=True,
                guardian__user_id__isnull=False,
            )
            .values_list("student_id", "guardian__user_id")
        )
        for student_id, user_id in links:
            guardians.setdefault(student_id, []).append(user_id)

        for card in cards:
            recipients = [
                Recipient(user_id=user_id)
                for user_id in dict.fromkeys(
                    [
                        *([card.student.user_id] if card.student.user_id else []),
                        *guardians.get(card.student_id, []),
                    ]
                )
            ]
            if not recipients:
                # A student with no portal account and no portal-enabled
                # guardian is an ordinary state; §12 names no fallback.
                continue
            try:
                notify(
                    notifications.ADMIT_CARD_ISSUED,
                    tenant_id=uuid.UUID(tenant_id),
                    recipients=recipients,
                    context={
                        "exam.name": exam.name,
                        "school.name": school_name,
                        "student.first_name": card.student.first_name,
                        "admit_card_no": card.admit_card_no,
                    },
                    source_type="admit_cards",
                    source_id=card.pk,
                )
                sent += len(recipients)
            except Exception:
                # One card's announcement failing must not cost the rest of the
                # hall theirs. The card itself is issued either way.
                logger.exception(
                    "%s failed for admit card %s",
                    notifications.ADMIT_CARD_ISSUED,
                    card.admit_card_no,
                )

    return {"notified": sent}


@shared_task(base=TenantAwareTask, bind=True)
def import_marks_task(self, *, tenant_id: str, job_id: str, actor_id: str) -> None:
    """§9's marks import, row by row.

    Row-by-row rather than bulk, and that is the trade §6 asks for: "re-import
    failed rows only" needs a per-row verdict, which a `bulk_create` cannot
    give. The row count buys the error report.

    Progress is reported as it goes, because a school's whole marks sheet is
    long enough that a caller polling `GET /jobs/{id}` needs to see it moving.
    """
    import base64

    from apps.examinations import services
    from apps.examinations.models import ExamSubject
    from core.tenancy.context import tenant_atomic

    with tenant_atomic(uuid.UUID(tenant_id)):
        job = BackgroundJob.objects.get(pk=job_id)
    mark_running(job=job)

    try:
        payload = job.payload
        data = base64.b64decode(payload["content_base64"])
        rows = services.parse_marks_import(filename=payload["filename"], data=data)

        with tenant_atomic(uuid.UUID(tenant_id)):
            exam_subject = (
                ExamSubject.objects.alive()
                .select_related("exam")
                .get(pk=payload["exam_subject_id"])
            )
            # Built once for the whole file. Looked up per row it would be one
            # query each, and a six-hundred-row sheet is a real size.
            students = services.import_candidates_by_admission_number(exam_subject=exam_subject)

        errors: list[dict[str, str]] = []
        succeeded = 0
        total = len(rows) or 1
        for index, row in enumerate(rows, start=1):
            with tenant_atomic(uuid.UUID(tenant_id)):
                # +1 for the header line, so the row numbers in the error report
                # match what a spreadsheet editor shows.
                error = services.import_marks_row(
                    row=row,
                    row_number=index + 1,
                    exam_subject=exam_subject,
                    students_by_number=students,
                    actor_id=uuid.UUID(actor_id),
                )
            if error:
                errors.append(error)
            else:
                succeeded += 1
            if index % PROGRESS_EVERY == 0:
                update_progress(job=job, progress=int(index / total * 100))

        mark_succeeded(
            job=job,
            result={"rows": len(rows), "succeeded": succeeded, "errors": errors},
        )
    except Exception as exc:
        # The job row is the only place a caller polling GET /jobs/{id} can
        # learn this failed, so the failure is recorded rather than raised into
        # a retry.
        mark_failed(job=job, error=str(exc))


# How close a window has to be to closing before the reminder fires. Two days,
# so a teacher who has not started still has a working day to do it in — a
# reminder on the closing morning is a reminder about a deadline already missed.
REMINDER_LEAD_DAYS = 2


def remind_tenant_marks_entry(tenant_id: uuid.UUID) -> int:
    """§12's `exams.marks-entry-reminder`, for one tenant.

    Fires for exam-subjects whose window closes within `REMINDER_LEAD_DAYS` and
    which still have marks outstanding — measured against the *expected* roll,
    so a subject nobody has started counts and one that is merely unsubmitted
    does too.

    **Recipients are the allocated subject teachers**, from
    `academics.TeacherSubjectAllocation`, which is the same table
    `Marks.filter_assigned_to_user` resolves entry rights through. §12 says
    "teachers with pending entries", and a broadcast to all staff would be the
    kind of notification people learn to ignore.
    """
    import datetime

    from django.utils import timezone

    from apps.academics.models import TeacherSubjectAllocation
    from apps.examinations import notifications
    from apps.examinations.models import Exam, ExamStatus
    from apps.examinations.services import marks_entry_progress
    from core.notifications.services import Recipient, notify
    from core.tenancy.context import tenant_atomic
    from core.tenancy.models import Tenant

    horizon = timezone.now() + datetime.timedelta(days=REMINDER_LEAD_DAYS)
    sent = 0

    with tenant_atomic(tenant_id):
        school_name = Tenant.objects.get(pk=tenant_id).name
        exams = list(
            Exam.objects.alive().filter(
                status__in=[ExamStatus.SCHEDULED, ExamStatus.ONGOING, ExamStatus.MARKS_ENTRY]
            )
        )
        for exam in exams:
            for entry in marks_entry_progress(exam=exam):
                if entry["is_locked"] or entry["closes_at"] is None:
                    continue
                if entry["closes_at"] > horizon or entry["closes_at"] < timezone.now():
                    continue
                if entry["submitted"] >= entry["expected"]:
                    continue

                # `marks_entry_progress` carries `subject_id`/`class_id` so
                # this does not re-fetch the exam-subject per row — the N+1
                # shape PR B's review caught twice.
                teachers = list(
                    TeacherSubjectAllocation.objects.alive()
                    .filter(
                        subject_id=entry["subject_id"],
                        section__school_class_id=entry["class_id"],
                        effective_to__isnull=True,
                        staff__user_id__isnull=False,
                    )
                    .values_list("staff__user_id", flat=True)
                )
                recipients = [Recipient(user_id=user_id) for user_id in dict.fromkeys(teachers)]
                if not recipients:
                    continue
                try:
                    notify(
                        notifications.MARKS_ENTRY_REMINDER,
                        tenant_id=tenant_id,
                        recipients=recipients,
                        context={
                            "exam.name": exam.name,
                            "school.name": school_name,
                            "subject.name": entry["subject_name"],
                            "class.name": entry["class_name"],
                            "outstanding": str(entry["expected"] - entry["submitted"]),
                            "closes_at": entry["closes_at"].isoformat(),
                        },
                        source_type="exam_subjects",
                        source_id=entry["exam_subject_id"],
                    )
                    sent += len(recipients)
                except Exception:
                    logger.exception(
                        "%s failed for exam-subject %s",
                        notifications.MARKS_ENTRY_REMINDER,
                        entry["exam_subject_id"],
                    )
    return sent


@shared_task
def remind_marks_entry() -> dict[str, int]:
    """Daily, tenant by tenant.

    Tenant by tenant through `for_each_tenant` rather than one cross-tenant
    query: under RLS an unbound read does not raise, it silently matches zero
    rows, so the sweep shape is what makes this do anything at all. The same
    reason `attendance.lock_expired_attendance` is written this way.
    """
    return for_each_tenant(remind_tenant_marks_entry, job="exams-marks-reminder")
