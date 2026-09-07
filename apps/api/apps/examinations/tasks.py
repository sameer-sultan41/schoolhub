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


@shared_task(base=TenantAwareTask, bind=True)
def process_results_task(self, *, tenant_id: str, job_id: str, actor_id: str) -> None:
    """§16's `:process-results` — 202 + a job (api-architecture.md §2.7).

    Asynchronous because §5.5 grades every student in the school at once, and a
    2,000-student run is not work an exam clerk holds a request open for.

    The block on outstanding marks is checked **inside** the job as well as at
    the endpoint. The endpoint check is for the clerk's benefit — an immediate,
    readable refusal — and this one is what actually holds, because marks can
    change between the request and the worker picking it up.
    """
    from apps.examinations.models import Exam
    from apps.examinations.services import process_exam_results
    from core.tenancy.context import tenant_atomic

    with tenant_atomic(uuid.UUID(tenant_id)):
        job = BackgroundJob.objects.get(pk=job_id)
    mark_running(job=job)

    try:
        with tenant_atomic(uuid.UUID(tenant_id)):
            exam = (
                Exam.objects.alive().select_related("grading_scale").get(pk=job.payload["exam_id"])
            )
            outcome = process_exam_results(exam=exam, actor_id=uuid.UUID(actor_id))

        notify_results_pending_approval.delay(
            tenant_id=tenant_id, exam_id=str(job.payload["exam_id"])
        )
        mark_succeeded(job=job, result=outcome)
    except Exception as exc:
        mark_failed(job=job, error=str(exc))


@shared_task(base=TenantAwareTask)
def notify_results_pending_approval(*, tenant_id: str, exam_id: str) -> dict[str, int]:
    """§12's `exams.result-approval-pending`, to whoever holds the approve key.

    Recipients are resolved from the **permission**, not from a role name: §4
    makes approval delegable to `vice_principal`, and a school that has
    delegated it needs the notice to follow the delegation. Hard-coding
    `principal` would send it to someone who may not be able to act.
    """
    from apps.examinations import notifications
    from apps.examinations.models import Exam, Result, ResultStatus
    from core.notifications.services import Recipient, notify
    from core.rbac.models import User
    from core.rbac.permissions import effective_permission_keys
    from core.tenancy.context import tenant_atomic
    from core.tenancy.models import Tenant

    with tenant_atomic(uuid.UUID(tenant_id)):
        exam = Exam.objects.alive().filter(pk=exam_id).first()
        if exam is None:
            return {"notified": 0}
        school_name = Tenant.objects.get(pk=tenant_id).name
        pending = (
            Result.objects.alive().filter(exam=exam, status=ResultStatus.PENDING_APPROVAL).count()
        )
        if not pending:
            return {"notified": 0}

        # Every active user in the tenant, filtered by the key. The candidate
        # set is a school's staff, not its students, so this is small — and
        # `effective_permission_keys` is cached per user.
        recipients = [
            Recipient(user_id=user.pk)
            for user in User.objects.filter(is_active=True)
            if "exams.result.approve" in effective_permission_keys(user)
        ]
        if not recipients:
            logger.warning(
                "no user holds exams.result.approve in tenant %s; results are pending with "
                "nobody notified",
                tenant_id,
            )
            return {"notified": 0}

        try:
            notify(
                notifications.RESULT_APPROVAL_PENDING,
                tenant_id=uuid.UUID(tenant_id),
                recipients=recipients,
                context={
                    "exam.name": exam.name,
                    "school.name": school_name,
                    "student_count": str(pending),
                },
                source_type="exams",
                source_id=exam.pk,
            )
        except Exception:
            logger.exception(
                "%s failed for exam %s", notifications.RESULT_APPROVAL_PENDING, exam.pk
            )
            return {"notified": 0}

    return {"notified": len(recipients)}


@shared_task(base=TenantAwareTask)
def notify_results_published(*, tenant_id: str, exam_id: str, result_ids: list[str]) -> dict:
    """§12's `exams.result-published`, to the students whose results just moved.

    **`result_ids` is the rows that actually transitioned**, passed in by the
    caller rather than re-queried here. That is `attendance`'s review finding
    applied: alerting on *current* status meant a retry re-sent every guardian
    the same message, and publishing is idempotent by design, so a re-publish
    would do exactly that.

    A withheld result is absent from the list by construction — `publish_exam_results`
    excludes it — so no notice goes out about a result nobody can see.
    """
    from apps.examinations import notifications
    from apps.examinations.models import Exam, Result
    from apps.student_management.models import StudentGuardian
    from core.notifications.services import Recipient, notify
    from core.tenancy.context import tenant_atomic
    from core.tenancy.models import Tenant

    if not result_ids:
        return {"notified": 0}

    with tenant_atomic(uuid.UUID(tenant_id)):
        exam = Exam.objects.alive().filter(pk=exam_id).first()
        if exam is None:
            return {"notified": 0}
        school_name = Tenant.objects.get(pk=tenant_id).name
        rows = list(Result.objects.alive().filter(pk__in=result_ids).select_related("student"))
        if not rows:
            return {"notified": 0}

        guardians: dict = {}
        links = (
            StudentGuardian.objects.alive()
            .filter(
                student__in=[row.student for row in rows],
                has_portal_access=True,
                guardian__deleted_at__isnull=True,
                guardian__user_id__isnull=False,
            )
            .values_list("student_id", "guardian__user_id")
        )
        for student_id, user_id in links:
            guardians.setdefault(student_id, []).append(user_id)

        user_ids = []
        for row in rows:
            if row.student.user_id:
                user_ids.append(row.student.user_id)
            user_ids.extend(guardians.get(row.student_id, []))

        recipients = [Recipient(user_id=user_id) for user_id in dict.fromkeys(user_ids)]
        if not recipients:
            return {"notified": 0}

        try:
            # One call for the whole exam. §12's template names the exam, not the
            # grade — a result is not something to put in an email body, and the
            # portal is where a student reads it.
            notify(
                notifications.RESULT_PUBLISHED,
                tenant_id=uuid.UUID(tenant_id),
                recipients=recipients,
                context={"exam.name": exam.name, "school.name": school_name},
                source_type="exams",
                source_id=exam.pk,
            )
        except Exception:
            logger.exception("%s failed for exam %s", notifications.RESULT_PUBLISHED, exam.pk)
            return {"notified": 0}

    return {"notified": len(recipients)}


@shared_task(base=TenantAwareTask, bind=True)
def generate_report_cards_task(self, *, tenant_id: str, job_id: str, actor_id: str) -> None:
    """§16's `:generate-report-cards` — 202 + a job.

    **The attendance summary is fetched once for the whole cohort**, then each
    card renders from it. `services.attendance_summary_for` groups in SQL, which
    is what makes that possible; asking per student would be the N+1 both this
    module's review and `attendance.reports`' own docstring warn about.

    One PDF per card, and the job renders whatever has no `file_id` — so a
    partial failure is fixed by re-running rather than by unpicking a batch,
    the same property `render_admit_cards_task` has.
    """
    from apps.examinations import documents, services, uploads
    from apps.examinations.models import (
        Exam,
        ExamSubject,
        Marks,
        ReportCardStatus,
        Result,
        ResultOutcome,
        ResultStatus,
    )
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
            exam = (
                Exam.objects.alive()
                .select_related("term", "academic_session")
                .get(pk=job.payload["exam_id"])
            )
            services.assert_report_cards_are_generatable(exam)
            school_name = Tenant.objects.get(pk=tenant_id).name

            results = list(
                Result.objects.alive()
                .filter(exam=exam, status=ResultStatus.PUBLISHED)
                .exclude(outcome=ResultOutcome.WITHHELD)
                .select_related("student", "grade_band")
            )
            start_date, end_date = services.report_card_period(exam=exam)
            summaries = services.attendance_summary_for(
                students=[row.student for row in results],
                start_date=start_date,
                end_date=end_date,
            )

            # Marks and subject configuration for every student, fetched once.
            subjects = {
                subject.pk: subject
                for subject in ExamSubject.objects.alive()
                .filter(exam=exam)
                .select_related("subject")
            }
            marks_by_student: dict = {}
            for row in (
                Marks.objects.alive()
                .filter(exam_subject__exam=exam)
                .values(
                    "student_id",
                    "exam_subject_id",
                    "theory_marks",
                    "practical_marks",
                    "is_absent",
                    "is_exempt",
                )
            ):
                marks_by_student.setdefault(row["student_id"], []).append(row)

            cards = [
                services.upsert_report_card(
                    exam=exam,
                    result=result,
                    summary=summaries.get(result.student_id),
                    actor_id=uuid.UUID(actor_id),
                )
                for result in results
            ]
            results_by_student = {result.student_id: result for result in results}

        total = len(cards) or 1
        for index, card in enumerate(cards, start=1):
            try:
                with tenant_atomic(uuid.UUID(tenant_id)):
                    result = results_by_student[card.student_id]
                    document = documents.report_card_html(
                        card=card,
                        exam=exam,
                        student=result.student,
                        result=result,
                        subject_rows=_subject_rows(
                            marks_by_student.get(card.student_id, []), subjects
                        ),
                        school_name=school_name,
                    )
                    file = create_ready_file(
                        tenant_id=uuid.UUID(tenant_id),
                        purpose=uploads.REPORT_CARD.key,
                        original_name=(
                            f"report-card-{result.student.admission_number}-v{card.version}.pdf"
                        ),
                        mime_type="application/pdf",
                        data=render_pdf(document),
                        actor_id=uuid.UUID(actor_id),
                    )
                    card.file = file
                    card.status = ReportCardStatus.GENERATED
                    card.updated_by = uuid.UUID(actor_id)
                    card.save(update_fields=["file", "status", "updated_by", "updated_at"])
                rendered += 1
            except Exception as exc:
                # One card failing must not cost a whole cohort theirs. The card
                # keeps `draft` with no file, so a re-run picks it up.
                logger.exception("report card for %s failed to render", card.student_id)
                failed.append({"student_id": str(card.student_id), "error": str(exc)})

            if index % PROGRESS_EVERY == 0:
                update_progress(job=job, progress=int(index / total * 100))

        mark_succeeded(
            job=job, result={"rendered": rendered, "failed": failed, "cards": len(cards)}
        )
    except Exception as exc:
        mark_failed(job=job, error=str(exc))


def _subject_rows(marks: list[dict], subjects: dict) -> list[dict]:
    """One student's per-subject lines for their card. Pure — no queries.

    `verdict` is computed here rather than stored: a pass mark can be edited
    while an exam is open, and a card should print the verdict against the
    configuration it was generated under rather than a stale copy.
    """
    rows = []
    for row in marks:
        subject = subjects.get(row["exam_subject_id"])
        if subject is None:
            continue
        theory = row["theory_marks"]
        practical = row["practical_marks"]
        obtained = (theory or 0) + (practical or 0)
        maximum = subject.max_marks + (subject.practical_max_marks or 0)
        passed = theory is not None and theory >= subject.pass_marks
        rows.append(
            {
                "subject": subject.subject.name,
                "max_marks": maximum,
                "obtained": obtained,
                "is_absent": row["is_absent"],
                "is_exempt": row["is_exempt"],
                "verdict": "Pass" if passed else "Fail",
            }
        )
    return sorted(rows, key=lambda row: row["subject"])


@shared_task(base=TenantAwareTask)
def notify_report_cards_ready(*, tenant_id: str, exam_id: str, card_ids: list[str]) -> dict:
    """§12's `exams.report-card-ready`, for the cards that just published.

    `card_ids` is passed in rather than re-queried, for the reason
    `notify_results_published` gives: publishing is idempotent, and notifying on
    *current* state would re-send every guardian the same message on a
    re-publish. That is `attendance`'s review finding, and PR B's review found
    the other half of the same mistake here — a trigger registered with no
    caller at all.
    """
    from apps.examinations import notifications
    from apps.examinations.models import Exam, ReportCard
    from apps.student_management.models import StudentGuardian
    from core.notifications.services import Recipient, notify
    from core.tenancy.context import tenant_atomic
    from core.tenancy.models import Tenant

    if not card_ids:
        return {"notified": 0}

    with tenant_atomic(uuid.UUID(tenant_id)):
        exam = Exam.objects.alive().filter(pk=exam_id).first()
        if exam is None:
            return {"notified": 0}
        school_name = Tenant.objects.get(pk=tenant_id).name
        cards = list(ReportCard.objects.alive().filter(pk__in=card_ids).select_related("student"))
        if not cards:
            return {"notified": 0}

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

        user_ids = []
        for card in cards:
            if card.student.user_id:
                user_ids.append(card.student.user_id)
            user_ids.extend(guardians.get(card.student_id, []))

        recipients = [Recipient(user_id=user_id) for user_id in dict.fromkeys(user_ids)]
        if not recipients:
            return {"notified": 0}

        try:
            notify(
                notifications.REPORT_CARD_READY,
                tenant_id=uuid.UUID(tenant_id),
                recipients=recipients,
                context={"exam.name": exam.name, "school.name": school_name},
                source_type="report_cards",
                source_id=exam.pk,
            )
        except Exception:
            logger.exception("%s failed for exam %s", notifications.REPORT_CARD_READY, exam.pk)
            return {"notified": 0}

    return {"notified": len(recipients)}


@shared_task(base=TenantAwareTask, bind=True)
def assemble_paper_task(self, *, tenant_id: str, job_id: str, actor_id: str) -> None:
    """§16's `:assemble-paper` — 202 + a job producing a paper PDF.

    Deterministic, so re-running the same blueprint over an unchanged bank
    produces the same paper: `select_paper_questions` orders by `usage_count`
    then creation rather than sampling. A teacher who regenerates after fixing a
    typo in the title should not get a different exam.

    `record_paper_usage` runs in the same transaction as the selection, because
    §15 records that assembled papers are stored as files with **no table** to
    join against — so `usage_count` is the only record that a question was used,
    and a crash between the two would lose it.

    **The selection re-checks satisfiability under a row lock**, and that is not
    belt-and-braces with the endpoint's check — it is the one that holds. The
    endpoint checks so a teacher gets an immediate, readable refusal; this runs
    later, and between the two a concurrent assembly can take the questions or
    someone can unapprove one. A shortfall here fails the **job** rather than
    truncating, because a paper missing its last section, marked succeeded, is
    discovered by a hall of students.
    """
    from apps.examinations import documents, services, uploads
    from apps.examinations.models import QuestionBank
    from core.documents import render_pdf
    from core.files.services import create_ready_file
    from core.tenancy.context import tenant_atomic
    from core.tenancy.models import Tenant

    with tenant_atomic(uuid.UUID(tenant_id)):
        job = BackgroundJob.objects.get(pk=job_id)
    mark_running(job=job)

    try:
        payload = job.payload
        with tenant_atomic(uuid.UUID(tenant_id)):
            bank = (
                QuestionBank.objects.alive()
                .select_related("subject")
                .get(pk=payload["question_bank_id"])
            )
            school_name = Tenant.objects.get(pk=tenant_id).name
            sections = services.select_paper_questions(bank=bank, sections=payload["sections"])
            total_marks = sum(
                (section.get("marks_each") or question.default_marks)
                for section in sections
                for question in section["questions"]
            )
            document = documents.exam_paper_html(
                bank=bank,
                sections=sections,
                title=payload["title"],
                total_marks=total_marks,
                school_name=school_name,
            )
            file = create_ready_file(
                tenant_id=uuid.UUID(tenant_id),
                purpose=uploads.EXAM_PAPER.key,
                original_name=f"{payload['title']}.pdf",
                mime_type="application/pdf",
                data=render_pdf(document),
                actor_id=uuid.UUID(actor_id),
            )
            used = services.record_paper_usage(
                questions=[question for section in sections for question in section["questions"]],
                actor_id=uuid.UUID(actor_id),
            )

        mark_succeeded(
            job=job,
            result={
                "result_file_id": str(file.pk),
                "questions": used,
                "total_marks": str(total_marks),
            },
        )
    except Exception as exc:
        mark_failed(job=job, error=str(exc))


@shared_task(base=TenantAwareTask, bind=True)
def export_exam_report_task(self, *, tenant_id: str, job_id: str, actor_id: str) -> None:
    """§13's export lane — the same rows the synchronous endpoint returns.

    The rows are recomputed here rather than carried in the job payload: a
    payload big enough to hold a school's result register is a payload big
    enough to be the reason the export exists.

    **The scope is recomputed too, from the requesting user.** A report is read
    as authoritative, so an export must not widen what its requester could see
    inline — which it would if the job re-queried without the record scope the
    endpoint applied. That is `attendance`'s export task's reasoning, and the
    same `build_report_rows` shape carries it.
    """
    from apps.examinations import services, uploads
    from core.exports import tabular
    from core.files.services import create_ready_file
    from core.rbac.models import User
    from core.tenancy.context import tenant_atomic

    with tenant_atomic(uuid.UUID(tenant_id)):
        job = BackgroundJob.objects.get(pk=job_id)
    mark_running(job=job)

    try:
        with tenant_atomic(uuid.UUID(tenant_id)):
            payload = job.payload
            requester = User.objects.get(pk=payload["requested_by"])
            # No `limit`: the job is the unbounded path, which is the whole
            # reason the endpoint hands it anything over the inline ceiling.
            rows = services.build_report_rows(
                kind=payload["kind"], exam_id=payload.get("exam_id"), user=requester
            )
            fmt = payload.get("format", "csv")
            title = payload["kind"].replace("-", " ").capitalize()
            data, mime_type, extension = tabular.render(rows, fmt=fmt, title=title)

            file = create_ready_file(
                tenant_id=uuid.UUID(tenant_id),
                purpose=uploads.RESULT_EXPORT.key,
                original_name=f"exams-{payload['kind']}.{extension}",
                mime_type=mime_type,
                data=data,
                actor_id=uuid.UUID(actor_id),
            )
        mark_succeeded(
            job=job,
            result={"result_file_id": str(file.pk), "rows": len(rows), "format": fmt},
        )
    except Exception as exc:
        mark_failed(job=job, error=str(exc))
