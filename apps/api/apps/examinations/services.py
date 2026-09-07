"""Business rules for the examinations module.

Fat services, thin views (`ENGINEERING_STANDARDS.md` §3). Every rule §11 states
lives here rather than in a serializer, for the reason `attendance.services`
gives: the same rules have to hold when a background job, an importer or a
later module reaches them, and a rule implemented in a `validate_*` method is a
rule only the HTTP path obeys.

This PR covers §5.1's setup half — grading scales, exams, and per-class subject
configuration. Marks, scheduling, processing and publishing arrive in the PRs
that ship their tables.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from apps.examinations import conflicts, grading, processing, reports
from apps.examinations.models import (
    OCCUPYING_SCHEDULE_STATUSES,
    AdmitCard,
    AdmitCardStatus,
    Exam,
    ExamSchedule,
    ExamStatus,
    ExamSubject,
    GradeBand,
    GradingScale,
    Marks,
    MarksStatus,
    Question,
    QuestionBank,
    QuestionSource,
    ReportCard,
    ReportCardStatus,
    Result,
    ResultOutcome,
    ResultStatus,
    ScheduleStatus,
)
from apps.school_organization.models import (
    AcademicSession,
    Class,
    ClassSubject,
    Section,
    Subject,
    Term,
)
from core.api.exceptions import Conflict, DomainRuleViolation
from core.rbac.models import RecordScope

# §7.1's lifecycle. An exam may only be *configured* — subjects added, marks
# structure changed, the scale swapped — while it is still in one of these
# states. Past `marks_entry` a configuration change would silently invalidate
# marks already entered against the old maximum, which is the kind of edit that
# produces a percentage nobody can reproduce.
CONFIGURABLE_STATUSES = frozenset({ExamStatus.DRAFT, ExamStatus.SCHEDULED})

# Deleting an exam is only safe while nothing downstream references it. §5.1
# makes an exam deletable, but a published result is a record a school has
# already given to a parent.
DELETABLE_STATUSES = frozenset({ExamStatus.DRAFT})


def assert_session_is_writable(session: AcademicSession) -> None:
    """Refuse work in a closed or archived session.

    `AcademicSession.is_writable` is school-organization's own predicate
    (`status in {planned, active}`) and this defers to it rather than restating
    the status list — a module that hardcoded the set would keep accepting
    writes the day a new status is added.
    """
    if not session.is_writable:
        raise DomainRuleViolation(
            {
                "academic_session_id": (
                    f"This session is {session.status} and no longer accepts changes. "
                    "Create the exam in an active session."
                )
            }
        )


def assert_term_belongs_to_session(*, session: AcademicSession, term: Term | None) -> None:
    """A term names a session; an exam must not straddle two.

    Both ids arrive from the client independently, so nothing but this stops an
    exam claiming Term 1 of last year inside this year's session — and the
    resulting exam would then appear in one session's lists and another's date
    range.
    """
    if term is not None and term.academic_session_id != session.pk:
        raise DomainRuleViolation({"term_id": "This term belongs to a different academic session."})


def assert_exam_dates_in_range(
    *, starts_on, ends_on, session: AcademicSession, term: Term | None
) -> None:
    """§11 — exam dates fall within the session, or within the term where set.

    The term is checked in preference to the session because it is the narrower
    claim: an exam inside the session but outside its own term is a scheduling
    error the admit cards would go on to print.

    A dateless exam passes. A draft has no dates yet, and §5.1 makes scheduling
    a later step than creation.
    """
    if starts_on is None:
        return
    if term is not None:
        if starts_on < term.start_date or ends_on > term.end_date:
            raise DomainRuleViolation(
                {
                    "starts_on": (
                        f"The exam runs {starts_on} to {ends_on}, outside {term.name} "
                        f"({term.start_date} to {term.end_date})."
                    )
                }
            )
        return
    if starts_on < session.start_date or ends_on > session.end_date:
        raise DomainRuleViolation(
            {
                "starts_on": (
                    f"The exam runs {starts_on} to {ends_on}, outside the session "
                    f"({session.start_date} to {session.end_date})."
                )
            }
        )


def assert_scale_usable(scale: GradingScale) -> None:
    """§11 — an exam may only use a scale whose bands cover every percentage.

    This is the gate the whole grading design turns on. `grade_bands` cannot
    hold contiguity as a constraint (see `models.py`'s header), so the rule has
    to be enforced *somewhere*, and the useful place is the moment a scale is
    attached to an exam: early enough that an admin fixes it on the settings
    screen, rather than at result processing, where the same problem is a failed
    job over a whole school's marks.
    """
    bands = list(GradeBand.objects.alive().filter(grading_scale=scale))
    grading.assert_scale_is_complete(bands)


def assert_exam_is_configurable(exam: Exam) -> None:
    """§7.1 — an exam past `marks_entry` is no longer configurable.

    Not a permission check: the caller may hold `exams.exam.update` and still be
    refused, because the objection is to the exam's state rather than to who
    they are. Editing `max_marks` after marks exist would rescale results
    already entered against the old maximum, and nothing in the data would
    record that it happened.
    """
    if exam.status not in CONFIGURABLE_STATUSES:
        raise Conflict(
            f"This exam is {exam.get_status_display().lower()} and its configuration is "
            "frozen. Marks have been entered against the current marks structure."
        )


def assert_exam_is_deletable(exam: Exam) -> None:
    """Only a draft exam may be deleted.

    A scheduled exam has admit cards and a room booking; anything further has
    marks. §5.1 makes an exam deletable and this is the narrowest reading that
    stays true to it — the wider operation a school actually wants past draft is
    `archived`, which is a status change rather than a delete.
    """
    if exam.status not in DELETABLE_STATUSES:
        raise Conflict(
            f"This exam is {exam.get_status_display().lower()}. Only a draft exam can be "
            "deleted; archive it instead to take it out of operational lists."
        )


def assert_subject_in_class_curriculum(
    *, session: AcademicSession, school_class: Class, subject: Subject
) -> None:
    """§11 — an exam-subject must be a subject the class actually studies.

    The same rule `academics.services.assert_subject_in_class_curriculum`
    enforces for a teacher allocation, keyed on the **class** rather than a
    section: an exam is configured per class, and every section of Grade 8 sits
    the same Grade 8 paper. Restated here rather than called across modules
    because the argument differs; the message deliberately matches, so an admin
    who has met this rule in the allocation screen recognises it here.
    """
    in_curriculum = (
        ClassSubject.objects.alive()
        .filter(academic_session=session, school_class=school_class, subject=subject)
        .exists()
    )
    if not in_curriculum:
        raise DomainRuleViolation(
            {
                "subject_id": (
                    "This subject is not in the curriculum for this class in this session. "
                    "Add it to the curriculum first."
                )
            }
        )


def assert_practical_marks(
    *, has_practical: bool, practical_max_marks, practical_pass_marks
) -> None:
    """§11's practical pairing, as a named 422 rather than a 409.

    The CHECK constraint holds this too, and deliberately — see `models.py`.
    What a constraint cannot do is say *which* field is wrong, and an
    IntegrityError surfacing as a bare 409 on a settings form is a worse
    experience than a field error. The service answers first; the constraint is
    what holds against a race.

    Takes plain values rather than an instance so a serializer can call it
    before anything is built — the shape every `assert_*` in this module uses
    for the same reason.
    """
    if has_practical and not practical_max_marks:
        raise DomainRuleViolation(
            {
                "practical_max_marks": (
                    "A subject with a practical component needs a practical maximum."
                )
            }
        )
    if (
        practical_pass_marks is not None
        and practical_max_marks is not None
        and practical_pass_marks > practical_max_marks
    ):
        raise DomainRuleViolation(
            {"practical_pass_marks": "Practical pass marks cannot exceed the practical maximum."}
        )


@transaction.atomic
def set_default_scale(*, scale: GradingScale, actor_id: uuid.UUID) -> GradingScale:
    """Make `scale` the tenant default, clearing whichever held it.

    Two statements inside one transaction rather than one `update()`: the
    partial unique index `grading_scales_one_default` refuses two live defaults,
    so the outgoing row has to be cleared *before* the new one is set, and doing
    that in a single autocommit `update()` would leave a window where neither
    is default. `select_for_update` on the outgoing row is what makes two admins
    pressing the button at once resolve to one winner rather than to a 500.
    """
    current = (
        GradingScale.objects.alive()
        .select_for_update()
        .filter(is_default=True)
        .exclude(pk=scale.pk)
        .first()
    )
    if current is not None:
        current.is_default = False
        current.updated_by = actor_id
        current.save(update_fields=["is_default", "updated_by", "updated_at"])

    if not scale.is_default:
        scale.is_default = True
        scale.updated_by = actor_id
        scale.save(update_fields=["is_default", "updated_by", "updated_at"])
    return scale


def default_scale() -> GradingScale | None:
    """The tenant's default grading scale, or None if none is set."""
    return GradingScale.objects.alive().filter(is_default=True).first()


# --- §5.2 scheduling -------------------------------------------------------


def assert_schedule_is_editable(schedule: ExamSchedule) -> None:
    """A completed sitting is history; a cancelled one is a decision already made.

    Not a permission check — the caller may hold `exams.schedule.update` and
    still be refused, because the objection is to the row's state. Editing a
    completed sitting would move a date students have already sat.
    """
    if schedule.status != ScheduleStatus.SCHEDULED:
        raise Conflict(
            f"This sitting is {schedule.get_status_display().lower()} and can no longer be "
            "rescheduled."
        )


def assert_section_studies_the_class(*, exam_subject: ExamSubject, section: Section) -> None:
    """A sitting must pair an exam-subject with a section of *that* class.

    Nothing else stops a Grade 8 paper being scheduled for a Grade 3 section:
    both ids arrive from the client and each is individually valid. The
    resulting sitting would print on those students' admit cards and produce
    marks rows against a paper they never studied.
    """
    if section.school_class_id != exam_subject.school_class_id:
        raise DomainRuleViolation(
            {
                "section_id": (
                    "This section is not in the class this exam-subject is configured for."
                )
            }
        )


@transaction.atomic
def save_schedule_with_conflicts(*, schedule: ExamSchedule, actor_id: uuid.UUID) -> list[dict]:
    """Persist a sitting and return every clash it now participates in.

    **Saves first, then reports.** §5.2 wants a clash *list*, and a schedule
    mid-build is allowed to be imperfect — an exam-staff journey (§8) is
    "resolves the two room clashes the checker flags", which requires the
    clashing state to be storable. `:publish-schedule` is where hard conflicts
    become blocking, exactly as `timetable`'s draft grid and `:publish` divide
    the same responsibility.
    """
    schedule.updated_by = actor_id
    schedule.save()
    return conflicts.detect_conflicts(exam=schedule.exam_subject.exam)


@transaction.atomic
def publish_exam_schedule(*, exam: Exam, actor_id: uuid.UUID) -> dict:
    """§16's `POST /exams/{id}:publish-schedule` — release the timetable.

    Refuses on any **hard** conflict and reports all of them at once, because a
    school fixing one clash at a time discovers the next only after saving. Soft
    conflicts are returned alongside the success: an over-capacity hall the
    school intends to split should not block a publish, and §5.5's hard/soft
    split exists for exactly this decision.

    Moves the exam to `scheduled`, which is what makes admit cards issuable —
    §5.3 issues them per exam per section, and there is nothing to print before
    a sitting has a date, a time and a room.
    """
    findings = conflicts.detect_conflicts(exam=exam)
    hard = [finding for finding in findings if finding["severity"] == "hard"]
    if hard:
        raise DomainRuleViolation(
            (f"{len(hard)} clash(es) must be resolved before this schedule can be published."),
            meta={"conflicts": findings},
        )

    if not ExamSchedule.objects.alive().filter(exam_subject__exam=exam).exists():
        raise DomainRuleViolation(
            {"exam_id": "This exam has no sittings scheduled yet, so there is nothing to publish."}
        )

    exam.status = ExamStatus.SCHEDULED
    exam.updated_by = actor_id
    exam.save(update_fields=["status", "updated_by", "updated_at"])
    return {"status": exam.status, "conflicts": findings}


# --- §5.3 admit cards ------------------------------------------------------

# `{exam sequence}-{admission number}`, which is what an invigilator reads off a
# card and checks against a list. Derived rather than random so a lost card can
# be re-derived from the student's own admission number, and prefixed by the
# exam so two exams' cards for the same student never collide.
ADMIT_CARD_NUMBER_TEMPLATE = "{prefix}-{admission_number}"


def admit_card_number(*, exam: Exam, admission_number: str) -> str:
    """The number printed on one student's card for one exam.

    The prefix is the exam's first eight id characters rather than its name: a
    name is edited, contains spaces and non-ASCII, and is not unique across
    sessions — none of which a number a student writes on a paper can afford.
    """
    return ADMIT_CARD_NUMBER_TEMPLATE.format(
        prefix=str(exam.pk)[:8].upper(), admission_number=admission_number
    )


def assert_exam_is_issuable(exam: Exam) -> None:
    """§5.3 — admit cards need a published schedule to print.

    A card carries the student's own sitting dates, times and rooms (§5.3's
    "delivered as PDFs"), so issuing before the schedule is published would
    print a document that is about to change. `draft` is the refusal that
    matters; anything from `scheduled` onward has dates.
    """
    if exam.status == ExamStatus.DRAFT:
        raise Conflict(
            "This exam's schedule has not been published, so an admit card would print "
            "dates that are still being edited. Publish the schedule first."
        )


def admit_card_candidates(*, exam: Exam) -> list:
    """The students an exam issues cards to — one query, plus one for the ids.

    Resolved from **active enrollments in the sections this exam is actually
    scheduled for**, not from every student in the school. A school runs
    Grade 8's midterm without issuing Grade 3 a card, and a student who has
    withdrawn since the exam was configured is not sitting it.
    """
    from apps.student_management.models import EnrollmentStatus, Student, StudentEnrollment

    section_ids = (
        ExamSchedule.objects.alive()
        .filter(exam_subject__exam=exam, status__in=OCCUPYING_SCHEDULE_STATUSES)
        .values_list("section_id", flat=True)
    )
    student_ids = (
        StudentEnrollment.objects.alive()
        .filter(section_id__in=list(section_ids), status=EnrollmentStatus.ACTIVE)
        .values_list("student_id", flat=True)
    )
    return list(
        Student.objects.alive().filter(pk__in=list(student_ids)).order_by("admission_number")
    )


@transaction.atomic
def issue_admit_cards(*, exam: Exam, actor_id: uuid.UUID) -> dict:
    """§5.3's batch issue. Idempotent: a re-run tops up rather than colliding.

    **A re-run is the normal case, not an error.** A student admitted after the
    first batch needs a card, and §8's exam-staff journey is "issues admit cards
    in one batch" — which in practice means pressing the button again after the
    roll changes. So this creates only what is missing and reports both numbers.

    A **revoked** card is deliberately not re-created. Revocation is a policy
    decision someone made (§5.3's fee-clearance case), and a top-up run
    silently reinstating it would undo that decision without anyone asking.
    """
    assert_exam_is_issuable(exam)

    students = admit_card_candidates(exam=exam)
    existing = set(AdmitCard.objects.alive().filter(exam=exam).values_list("student_id", flat=True))
    missing = [student for student in students if student.pk not in existing]

    created = [
        AdmitCard(
            tenant=exam.tenant,
            exam=exam,
            student=student,
            admit_card_no=admit_card_number(exam=exam, admission_number=student.admission_number),
            status=AdmitCardStatus.GENERATED,
            created_by=actor_id,
            updated_by=actor_id,
        )
        for student in missing
    ]
    # `ignore_conflicts`: two exam staff pressing the button at once both read
    # the same "missing" set, and `admit_cards_one_per_student_per_exam` lets
    # exactly one of them insert each row. The loser's duplicates are dropped
    # rather than turning a legitimate retry into a 409 — the same reasoning
    # `attendance.bulk_mark_student_attendance` applies to a re-submitted
    # register.
    AdmitCard.objects.bulk_create(created, ignore_conflicts=True)

    # Counted from the database, not from `len(created)`. Review found the
    # latter overstating under exactly the race `ignore_conflicts` exists to
    # absorb: the loser of a concurrent double-issue attempted N rows, inserted
    # none, and reported N. `bulk_create(ignore_conflicts=True)` cannot say
    # which of its objects landed — on PostgreSQL the returned instances have
    # no reliable primary keys — so the honest number comes from a re-count.
    total_now = AdmitCard.objects.alive().filter(exam=exam).count()
    issued = total_now - len(existing)

    return {
        "issued": issued,
        "already_issued": len(existing),
        "students": len(students),
        # What this run *tried* to create, so a caller that sees `issued` come
        # back lower knows a concurrent run took the difference rather than
        # that students were skipped.
        "attempted": len(created),
    }


@transaction.atomic
def revoke_admit_card(*, card: AdmitCard, reason: str, actor_id: uuid.UUID) -> AdmitCard:
    """§5.3 — revoke an issued card, with a reason.

    The reason is required by a CHECK constraint as well as here: a revocation
    nobody can explain is the one a parent will ask about, and "why" is the part
    that has to survive into the audit log.
    """
    if card.status == AdmitCardStatus.REVOKED:
        raise Conflict("This admit card is already revoked.")
    card.status = AdmitCardStatus.REVOKED
    card.revoked_reason = reason
    card.updated_by = actor_id
    card.save(update_fields=["status", "revoked_reason", "updated_by", "updated_at"])
    return card


def student_sittings(*, exam: Exam, student) -> list:
    """The sittings one student attends for an exam — what their card prints.

    Resolved through the student's active enrollment, so a card lists only the
    papers their own section sits rather than every paper in the exam.
    """
    from apps.student_management.models import EnrollmentStatus, StudentEnrollment

    section_ids = (
        StudentEnrollment.objects.alive()
        .filter(student=student, status=EnrollmentStatus.ACTIVE)
        .values_list("section_id", flat=True)
    )
    return list(
        ExamSchedule.objects.alive()
        .filter(
            exam_subject__exam=exam,
            section_id__in=list(section_ids),
            status__in=OCCUPYING_SCHEDULE_STATUSES,
        )
        .select_related("exam_subject__subject", "room")
        .order_by("exam_date", "start_time")
    )


def sittings_by_student(*, exam: Exam, students: list) -> dict:
    """Every student's sittings for an exam, in two queries flat.

    The batch form of `student_sittings`. Review found the admit-card render job
    calling the single form once per card — two queries each, so a batch of
    three hundred cards was six hundred round trips, which is exactly what
    `conflicts.collect_scope`'s own docstring warns against and what
    `ENGINEERING_STANDARDS.md` §3 calls an N+1.

    Returns `{student_id: [ExamSchedule, ...]}`, ordered as a card prints them.
    A student with no scheduled paper is absent from the mapping rather than
    present with an empty list, so a caller has to decide what that means —
    `documents.admit_card_html` prints "no papers scheduled yet".
    """
    from apps.student_management.models import EnrollmentStatus, StudentEnrollment

    sections_by_student: dict = {}
    enrollments = (
        StudentEnrollment.objects.alive()
        .filter(student__in=students, status=EnrollmentStatus.ACTIVE)
        .values_list("student_id", "section_id")
    )
    for student_id, section_id in enrollments:
        sections_by_student.setdefault(student_id, set()).add(section_id)

    schedules_by_section: dict = {}
    sittings = (
        ExamSchedule.objects.alive()
        .filter(exam_subject__exam=exam, status__in=OCCUPYING_SCHEDULE_STATUSES)
        .select_related("exam_subject__subject", "room")
        .order_by("exam_date", "start_time")
    )
    for sitting in sittings:
        schedules_by_section.setdefault(sitting.section_id, []).append(sitting)

    answers: dict = {}
    for student_id, section_ids in sections_by_student.items():
        rows = [
            sitting
            for section_id in section_ids
            for sitting in schedules_by_section.get(section_id, [])
        ]
        if rows:
            # Re-sorted because a student in two sections has two already-sorted
            # lists concatenated, which is not itself sorted.
            answers[student_id] = sorted(rows, key=lambda row: (row.exam_date, row.start_time))
    return answers


# --- §5.4 marks entry ------------------------------------------------------

# The statuses a caller may set through `:bulk-entry`. `locked` is not among
# them: locking is `:lock-marks`, which is permission-gated and audited, and a
# grid submit that could set it would let a teacher close their own window.
ENTRY_SETTABLE_STATUSES = (MarksStatus.DRAFT, MarksStatus.SUBMITTED)

# The exam statuses during which marks may be written at all. §7.1 sends a
# rejected exam back to `marks_entry`, and that transition is what re-opens
# entry — not an edit that slips past the gate.
MARKS_WRITABLE_EXAM_STATUSES = frozenset(
    {ExamStatus.SCHEDULED, ExamStatus.ONGOING, ExamStatus.MARKS_ENTRY}
)

MARKS_WRITE_FIELDS = (
    "theory_marks",
    "practical_marks",
    "is_absent",
    "is_exempt",
    "status",
    "remarks",
    "entered_by",
    "updated_by",
)


def assert_marks_window_open(exam_subject: ExamSubject) -> None:
    """§6's entry window and §5.4's lock, as one gate.

    Three refusals, and the messages differ because the remedies differ: a
    window that has not opened is a date to wait for, a closed one is a date to
    extend, and a locked subject needs `:unlock-marks` and the key that
    guards it. A single "entry is closed" would leave a teacher guessing which.

    An **unset** window means always open. A school that has not configured
    entry dates has not asked to be gated, and refusing on a null would make
    the window mandatory — which §6 does not say and no migration set.
    """
    if exam_subject.marks_locked_at is not None:
        raise Conflict(
            "Marks for this subject are locked. They can only be changed after an unlock, "
            "which is audited."
        )

    now = timezone.now()
    if exam_subject.marks_entry_opens_at and now < exam_subject.marks_entry_opens_at:
        opens = exam_subject.marks_entry_opens_at
        raise Conflict(f"Marks entry for this subject opens {opens:%Y-%m-%d %H:%M}.")
    if exam_subject.marks_entry_closes_at and now > exam_subject.marks_entry_closes_at:
        raise Conflict(
            f"Marks entry for this subject closed "
            f"{exam_subject.marks_entry_closes_at:%Y-%m-%d %H:%M}. Ask for the window to be "
            "reopened."
        )


def assert_exam_accepts_marks(exam: Exam) -> None:
    """§7.1 — marks may not be written once results are approved or published.

    The one-way gate the whole result cycle depends on. Editing a mark after
    approval would leave a published result that no longer follows from its
    inputs, and nothing in the data would record that it happened. §7.1's
    "changes requested" path sends the exam back to `marks_entry`, and *that*
    transition is what re-opens entry.
    """
    if exam.status not in MARKS_WRITABLE_EXAM_STATUSES:
        raise Conflict(
            f"This exam is {exam.get_status_display().lower()}, so its marks are closed. "
            "Send the results back for correction to reopen entry."
        )


def assert_marks_within_maximum(
    *, exam_subject: ExamSubject, theory_marks, practical_marks
) -> None:
    """§11 — `0 <= obtained <= max_marks` per component.

    The upper half of the rule, which no CHECK can hold: it compares this row
    against a column on `exam_subjects`. The message names the maximum, because
    "out of range" leaves a teacher with a grid of forty cells and no idea which
    bound they crossed.
    """
    if theory_marks is not None and theory_marks > exam_subject.max_marks:
        raise DomainRuleViolation(
            {
                "theory_marks": (
                    f"{theory_marks} is above this subject's maximum of {exam_subject.max_marks}."
                )
            }
        )
    if practical_marks is None:
        return
    if not exam_subject.has_practical:
        raise DomainRuleViolation({"practical_marks": "This subject has no practical component."})
    if (
        exam_subject.practical_max_marks is not None
        and practical_marks > exam_subject.practical_max_marks
    ):
        raise DomainRuleViolation(
            {
                "practical_marks": (
                    f"{practical_marks} is above this subject's practical maximum of "
                    f"{exam_subject.practical_max_marks}."
                )
            }
        )


def assert_marker_may_enter(*, user, exam_subject: ExamSubject) -> None:
    """§4 — a teacher may only enter marks for a class-subject they are on.

    Resolved through `academics.TeacherSubjectAllocation`, the table academics
    built for exactly this. An `all`- or `campus`-scoped caller returns early:
    many `exam_staff` and admin users have no `Staff` row at all, so requiring
    an allocation would break the legitimate case — the same early return
    `attendance.assert_marker_may_mark_section` makes, and the same reason the
    principal check has to sit in the *view* rather than inside here.
    """
    from apps.academics.models import TeacherSubjectAllocation
    from apps.staff_management.models import EmploymentStatus, Staff
    from core.rbac.permissions import user_scopes

    # `user_scopes` is keyed by **scope type**, not by permission key — the
    # shape `attendance.assert_marker_may_mark_section` already reads. Keying it
    # by permission returned nothing and made every caller look unscoped, which
    # is how CI caught this.
    scopes = user_scopes(user)
    if RecordScope.ALL in scopes or RecordScope.CAMPUS in scopes:
        return
    if RecordScope.ASSIGNED not in scopes:
        # `own` alone cannot enter marks: a student scoring their own paper is
        # not a workflow §5 describes.
        raise DomainRuleViolation(
            {"exam_subject_id": "You are not assigned to enter marks for this subject."}
        )

    staff_ids = list(
        Staff.objects.alive()
        .filter(user_id=user.pk, employment_status=EmploymentStatus.ACTIVE)
        .values_list("pk", flat=True)
    )
    if not staff_ids:
        raise DomainRuleViolation(
            {
                "exam_subject_id": (
                    "Marks entry is scoped to the class-subjects you teach, and this account "
                    "has no active staff record."
                )
            }
        )

    teaches = (
        TeacherSubjectAllocation.objects.alive()
        .filter(
            staff_id__in=staff_ids,
            subject_id=exam_subject.subject_id,
            section__school_class_id=exam_subject.school_class_id,
            effective_to__isnull=True,
        )
        .exists()
    )
    if not teaches:
        raise DomainRuleViolation(
            {
                "exam_subject_id": (
                    "You are not currently allocated to teach this subject to this class, so "
                    "you cannot enter its marks."
                )
            }
        )


def _entry_students(*, exam_subject: ExamSubject) -> dict:
    """The students eligible for this exam-subject's marks, by id.

    Eligibility is an **active enrollment in a section of the exam-subject's
    class**, in the exam's session. A student who has withdrawn since the exam
    was configured is not marked, and a student from another year group is not
    silently accepted because their id was posted.
    """
    from apps.student_management.models import EnrollmentStatus, Student, StudentEnrollment

    student_ids = (
        StudentEnrollment.objects.alive()
        .filter(
            academic_session_id=exam_subject.exam.academic_session_id,
            school_class_id=exam_subject.school_class_id,
            status=EnrollmentStatus.ACTIVE,
        )
        .values_list("student_id", flat=True)
    )
    return {
        student.pk: student for student in Student.objects.alive().filter(pk__in=list(student_ids))
    }


@transaction.atomic
def bulk_enter_marks(
    *, exam_subject: ExamSubject, entries: list[dict], user, actor_id: uuid.UUID
) -> dict:
    """§16's `POST /marks:bulk-entry` — one exam-subject's grid.

    **Upsert, not insert.** §16 calls this an "idempotent grid submit", and a
    teacher's browser genuinely does re-send: `bulk_create` would hit
    `marks_one_per_student_per_exam_subject` on the second attempt and fail the
    whole grid.

    **A rejected row rejects the whole submission**, reported through
    `error.meta.rows`. That is the opposite of `attendance`'s per-row *import*
    and the same as its `:bulk-mark`, deliberately: a grid is one act of
    judgement over one class, and a teacher who believes they saved forty marks
    and actually saved thirty-nine is worse off than one who is told which cell
    is wrong. Partial commit is never the outcome.

    `select_for_update` on the rows that already exist: two devices submitting
    the same grid within milliseconds both read "no row" otherwise, and the
    unique index turns the loser into a 500 rather than an update.
    """
    assert_exam_accepts_marks(exam_subject.exam)
    assert_marks_window_open(exam_subject)
    assert_marker_may_enter(user=user, exam_subject=exam_subject)

    eligible = _entry_students(exam_subject=exam_subject)
    rejected: list[dict] = []
    accepted: list[dict] = []

    for index, entry in enumerate(entries):
        student_id = entry["student_id"]
        if student_id not in eligible:
            rejected.append(
                {
                    "index": index,
                    "student_id": str(student_id),
                    "field": "student_id",
                    "issue": (
                        "This student has no active enrolment in a class this exam-subject covers."
                    ),
                }
            )
            continue
        try:
            assert_marks_within_maximum(
                exam_subject=exam_subject,
                theory_marks=entry.get("theory_marks"),
                practical_marks=entry.get("practical_marks"),
            )
        except DomainRuleViolation as exc:
            field, issue = next(iter(exc.detail.items()))
            rejected.append(
                {
                    "index": index,
                    "student_id": str(student_id),
                    "field": field,
                    "issue": str(issue),
                }
            )
            continue
        accepted.append(entry)

    if rejected:
        raise DomainRuleViolation(
            f"{len(rejected)} of {len(entries)} rows were rejected; nothing was saved.",
            meta={"rows": rejected},
        )

    existing = {
        row.student_id: row
        for row in Marks.objects.alive()
        .select_for_update()
        .filter(exam_subject=exam_subject, student_id__in=[e["student_id"] for e in accepted])
    }

    created = 0
    updated = 0
    for entry in accepted:
        row = existing.get(entry["student_id"])
        values = {
            "theory_marks": entry.get("theory_marks"),
            "practical_marks": entry.get("practical_marks"),
            "is_absent": entry.get("is_absent", False),
            "is_exempt": entry.get("is_exempt", False),
            "status": entry.get("status", MarksStatus.DRAFT),
            "remarks": entry.get("remarks"),
            "entered_by": actor_id,
            "updated_by": actor_id,
        }
        if row is None:
            Marks.objects.create(
                tenant=exam_subject.tenant,
                exam_subject=exam_subject,
                student_id=entry["student_id"],
                created_by=actor_id,
                **values,
            )
            created += 1
        else:
            for field, value in values.items():
                setattr(row, field, value)
            row.save(update_fields=[*MARKS_WRITE_FIELDS, "updated_at"])
            updated += 1

    # Entering marks is what moves an exam into `marks_entry`. Done here rather
    # than by a separate call so the status cannot lag behind the data — a
    # school looking at a `scheduled` exam that already holds marks has no way
    # to tell which is true.
    if exam_subject.exam.status in (ExamStatus.SCHEDULED, ExamStatus.ONGOING):
        exam_subject.exam.status = ExamStatus.MARKS_ENTRY
        exam_subject.exam.updated_by = actor_id
        exam_subject.exam.save(update_fields=["status", "updated_by", "updated_at"])

    return {"entered": created, "updated": updated, "rows": len(accepted)}


def marks_entry_progress(*, exam: Exam) -> list[dict]:
    """§13's marks-entry status report, and §6's missing-entries dashboard.

    Two queries flat, whatever the size of the exam: one for the expected roll
    per exam-subject and one for what has been entered. The obvious shape — for
    each subject, count its marks — is a query per subject, and an exam covers
    every subject in every year group.
    """
    from django.db.models import Count, Q

    from apps.student_management.models import EnrollmentStatus, StudentEnrollment

    subjects = list(
        ExamSubject.objects.alive()
        .filter(exam=exam)
        .select_related("school_class", "subject")
        .annotate(
            entered=Count("marks", filter=Q(marks__deleted_at__isnull=True)),
            submitted=Count(
                "marks",
                filter=Q(
                    marks__deleted_at__isnull=True,
                    marks__status__in=[MarksStatus.SUBMITTED, MarksStatus.LOCKED],
                ),
            ),
        )
    )

    expected_by_class: dict = {}
    counts = (
        StudentEnrollment.objects.alive()
        .filter(
            academic_session_id=exam.academic_session_id,
            status=EnrollmentStatus.ACTIVE,
            school_class_id__in=[subject.school_class_id for subject in subjects],
        )
        .values("school_class_id")
        .annotate(total=Count("student_id", distinct=True))
    )
    for row in counts:
        expected_by_class[row["school_class_id"]] = row["total"]

    return [
        {
            "exam_subject_id": subject.pk,
            # `class_id` and `subject_id` are carried, not only their names, so
            # a caller acting on a row — the reminder sweep resolving which
            # teachers to notify — does not have to re-fetch the exam-subject
            # per row. That re-fetch is the N+1 shape review caught twice in
            # PR B, and the fix belongs here rather than at each call site.
            "class_id": subject.school_class_id,
            "subject_id": subject.subject_id,
            "class_name": subject.school_class.name,
            "subject_name": subject.subject.name,
            "expected": expected_by_class.get(subject.school_class_id, 0),
            "entered": subject.entered,
            "submitted": subject.submitted,
            "is_locked": subject.marks_locked_at is not None,
            "closes_at": subject.marks_entry_closes_at,
        }
        for subject in subjects
    ]


@transaction.atomic
def lock_marks(*, exam_subject: ExamSubject, actor_id: uuid.UUID) -> dict:
    """§16's `:lock-marks` — close entry and stamp every row.

    Both halves matter. `marks_locked_at` closes the *window*, and stamping the
    rows `locked` is what result processing reads — a row still `draft` when its
    subject locked was never claimed as finished, and processing it silently
    would grade a student on a half-entered grid.

    Idempotent: locking an already-locked subject is a retry, not a conflict.
    """
    if exam_subject.marks_locked_at is not None:
        return {"locked_rows": 0, "already_locked": True}

    locked = (
        Marks.objects.alive()
        .filter(exam_subject=exam_subject)
        .update(status=MarksStatus.LOCKED, updated_by=actor_id, updated_at=timezone.now())
    )
    exam_subject.marks_locked_at = timezone.now()
    exam_subject.updated_by = actor_id
    exam_subject.save(update_fields=["marks_locked_at", "updated_by", "updated_at"])
    return {"locked_rows": locked, "already_locked": False}


@transaction.atomic
def unlock_marks(*, exam_subject: ExamSubject, actor_id: uuid.UUID) -> dict:
    """§6's re-open — "requires `exams.marks.lock` and is audited".

    Rows return to `submitted`, not `draft`: they *were* submitted, and sending
    them back to draft would lose the distinction the missing-entries dashboard
    depends on and make every re-opened subject look unfinished.

    Refused once results are approved. Unlocking then would let a mark change
    under a result a school has already given to a parent; §7.1's route for
    that is to send the results back, which returns the exam to `marks_entry`.
    """
    assert_exam_accepts_marks(exam_subject.exam)

    if exam_subject.marks_locked_at is None:
        return {"unlocked_rows": 0, "already_unlocked": True}

    unlocked = (
        Marks.objects.alive()
        .filter(exam_subject=exam_subject, status=MarksStatus.LOCKED)
        .update(status=MarksStatus.SUBMITTED, updated_by=actor_id, updated_at=timezone.now())
    )
    exam_subject.marks_locked_at = None
    exam_subject.updated_by = actor_id
    exam_subject.save(update_fields=["marks_locked_at", "updated_by", "updated_at"])
    return {"unlocked_rows": unlocked, "already_unlocked": False}


# --- §9's marks import ----------------------------------------------------

# The template headers. Exact names, no column-mapping UI — the same contract
# `student_management`'s importer and `attendance`'s set, and for the same
# reason: a mapping screen is a feature, and inventing one here would put an
# undocumented UI between a school and its data.
MARKS_IMPORT_COLUMNS = (
    "admission_number",
    "theory_marks",
    "practical_marks",
    "is_absent",
    "is_exempt",
    "remarks",
)
REQUIRED_MARKS_IMPORT_COLUMNS = ("admission_number",)

_TRUTHY = frozenset({"1", "true", "yes", "y", "t"})


def parse_marks_import(*, filename: str, data: bytes) -> list[dict[str, str]]:
    """Parse a CSV or .xlsx marks sheet into row dicts.

    Delegates to `student_management`'s parser rather than growing a third copy:
    it already handles the BOM Excel's "CSV UTF-8" adds and the
    read-only/data-only workbook flags, both of which are silently wrong in a
    reimplementation. `attendance.parse_attendance_import` delegates to the
    same one.
    """
    from apps.student_management.services import parse_import_rows

    return parse_import_rows(filename=filename, data=data)


def _import_decimal(raw: str, field: str) -> tuple[object, str | None]:
    """A mark from a spreadsheet cell. Returns `(value, error)`.

    Blank is None, not zero — the distinction the whole import turns on. A
    school leaves a cell empty for a student who did not sit, and reading that
    as zero would fail them rather than mark them absent.
    """
    text = (raw or "").strip()
    if not text:
        return None, None
    try:
        return Decimal(text), None
    except ArithmeticError, ValueError:
        return None, f"{field}: {text!r} is not a number."


def import_marks_row(
    *,
    row: dict[str, str],
    row_number: int,
    exam_subject: ExamSubject,
    students_by_number: dict,
    actor_id: uuid.UUID,
) -> dict[str, str] | None:
    """Write one imported marks row. Returns None, or a row-level error.

    The error's `row` is stringified, matching
    `attendance.import_attendance_row`. Not because a number is wrong in JSON,
    but because a client consuming both importers' job payloads should not get
    an int from one and a string from the other.

    **Per-row, unlike `bulk_enter_marks`, and that difference is deliberate.**
    A grid submit is one act of judgement over one class, so a bad cell rejects
    the whole thing. An import is a file of hundreds a school is migrating or
    transcribing, and §6's "re-import failed rows only" needs a per-row verdict
    — which a whole-file rejection cannot give.

    **Unlike `attendance`'s import, this path applies the *same* rules the grid
    does** — window, lock, maximum. The contrast is worth stating because a
    reader who has met that importer will expect the exemptions: attendance's
    rows are historical *by construction*, so its calendar and lock gates would
    reject the entire file. These rows are this exam's marks arriving by a
    different door, and the window is exactly as relevant as it is to a teacher
    typing them.
    """
    admission_number = (row.get("admission_number") or "").strip()
    if not admission_number:
        return {"row": str(row_number), "field": "admission_number", "issue": "Missing."}

    student = students_by_number.get(admission_number)
    if student is None:
        return {
            "row": str(row_number),
            "field": "admission_number",
            "issue": (
                f"No active enrolment for {admission_number!r} in a class this exam-subject covers."
            ),
        }

    theory, error = _import_decimal(row.get("theory_marks", ""), "theory_marks")
    if error:
        return {"row": str(row_number), "field": "theory_marks", "issue": error}
    practical, error = _import_decimal(row.get("practical_marks", ""), "practical_marks")
    if error:
        return {"row": str(row_number), "field": "practical_marks", "issue": error}

    is_absent = (row.get("is_absent") or "").strip().lower() in _TRUTHY
    is_exempt = (row.get("is_exempt") or "").strip().lower() in _TRUTHY

    if is_absent and (theory is not None or practical is not None):
        return {
            "row": str(row_number),
            "field": "is_absent",
            "issue": "An absent student cannot also have a mark.",
        }
    if is_absent and is_exempt:
        return {
            "row": str(row_number),
            "field": "is_exempt",
            "issue": "Absent and exempt are different claims; a row cannot assert both.",
        }

    try:
        assert_marks_within_maximum(
            exam_subject=exam_subject, theory_marks=theory, practical_marks=practical
        )
    except DomainRuleViolation as exc:
        field, issue = next(iter(exc.detail.items()))
        return {"row": str(row_number), "field": field, "issue": str(issue)}

    Marks.objects.update_or_create(
        tenant=exam_subject.tenant,
        exam_subject=exam_subject,
        student=student,
        defaults={
            "theory_marks": theory,
            "practical_marks": practical,
            "is_absent": is_absent,
            "is_exempt": is_exempt,
            # `submitted`, not `draft`: a school importing a sheet is asserting
            # these are the marks, not saving a working state. §6's re-import
            # of failed rows lands the same way.
            "status": MarksStatus.SUBMITTED,
            "remarks": (row.get("remarks") or "").strip() or None,
            "entered_by": actor_id,
            "updated_by": actor_id,
            "created_by": actor_id,
        },
    )
    return None


def import_candidates_by_admission_number(*, exam_subject: ExamSubject) -> dict:
    """The eligible students keyed by admission number, for the importer.

    Keyed by admission number because that is what a spreadsheet carries — a
    school transcribing a marks sheet has the number on the paper, not a UUID.
    Built once per file rather than looked up per row, which is what keeps a
    six-hundred-row import from being six hundred queries.
    """
    return {
        student.admission_number: student
        for student in _entry_students(exam_subject=exam_subject).values()
    }


# --- §5.5 processing, §5.6 approval and publishing -------------------------

# An exam may only be recomputed while nothing downstream has been settled.
# §7.1's "changes requested" path returns an exam here from `approved`.
RECOMPUTABLE_EXAM_STATUSES = frozenset(
    {
        ExamStatus.SCHEDULED,
        ExamStatus.ONGOING,
        ExamStatus.MARKS_ENTRY,
        ExamStatus.PROCESSING,
    }
)


def assert_exam_is_recomputable(exam: Exam) -> None:
    """§6 — "recompute is idempotent and re-runnable **until approval**".

    Refused once approved, because a recompute then would change a figure a
    principal has already signed off, and the approval record would still name
    them. §7.1's route is to send the results back, which returns the exam to
    `marks_entry` and re-opens both entry and processing.
    """
    if exam.status not in RECOMPUTABLE_EXAM_STATUSES:
        raise Conflict(
            f"This exam is {exam.get_status_display().lower()}. Results can only be "
            "reprocessed before approval — send them back for correction first."
        )


@transaction.atomic
def process_exam_results(*, exam: Exam, actor_id: uuid.UUID) -> dict:
    """§5.5's batch — totals, percentage, grade, GPA, ranks, outcome.

    Idempotent by construction: `processing.write` upserts, so a second run
    updates in place rather than colliding with
    `results_one_per_student_per_exam`.

    Moves the exam to `processing` and every row to `pending_approval`, which is
    what puts it in front of §5.6's approver. The exam's own status is not set
    to `approved` here — that is a separate, differently-permissioned act, and
    conflating them would be the segregation-of-duties failure §4 exists to
    prevent.
    """
    exam = lock_exam(exam)
    assert_exam_is_recomputable(exam)

    scope = processing.collect(exam=exam)
    processing.assert_ready_to_process(scope)
    computed = processing.compute(scope)
    outcome = processing.write(exam=exam, computed=computed, actor_id=actor_id)

    exam.status = ExamStatus.PROCESSING
    exam.updated_by = actor_id
    exam.save(update_fields=["status", "updated_by", "updated_at"])

    return {**outcome, "students": len(computed)}


def assert_approver_is_not_the_processor(*, results: list, approver_id: uuid.UUID) -> None:
    """§4's closing line — "the approver cannot be the user who ran processing".

    auth-and-rbac §2.4's segregation of duties, and the one check in this module
    that exists purely to stop a single person completing a two-person process.
    Checked in `services` rather than the viewset because the rule is the
    module's: it has to hold when a later caller approves through some other
    door.

    Compared against `created_by` on the result rows, which `processing.write`
    stamps with the processing initiator. Reading it from the rows rather than
    from the exam is deliberate: the exam's `updated_by` is whoever touched it
    last, which after a rename is not the processor at all.
    """
    processors = {row.created_by for row in results if row.created_by is not None}
    if approver_id in processors:
        raise DomainRuleViolation(
            {
                "approved_by": (
                    "You ran the processing for this exam, so you cannot also approve it. "
                    "Results need a second pair of eyes (§4)."
                )
            }
        )


def lock_exam(exam: Exam) -> Exam:
    """Re-read the exam under `SELECT ... FOR UPDATE` and return the locked row.

    **Every action that reads a status and writes it back must call this**, and
    review found `:approve-results`, `:send-results-back` and
    `:publish-results` not doing so while `set_default_scale` and
    `bulk_enter_marks` in this same file did — the module was inconsistent with
    itself.

    The race is not theoretical. Two near-simultaneous approvals both pass the
    `status == processing` check, both `bulk_update`, and the loser's commit
    overwrites `approved_by`/`approved_at` — corrupting the very audit trail
    the segregation-of-duties rule exists to protect. The same window lets a
    concurrent publish schedule §12's guardian notification twice.

    Locking the **exam** row rather than the result rows is deliberate: it is
    the one row all three actions have in common, so it serialises them against
    each other rather than only against themselves. The result rows are then
    read inside the same transaction, behind that lock.

    Returns the re-read instance, so callers see committed state rather than
    the possibly-stale one they were handed.
    """
    return Exam.objects.select_for_update().get(pk=exam.pk)


@transaction.atomic
def approve_exam_results(*, exam: Exam, approver_id: uuid.UUID) -> dict:
    """§5.6 — the principal's gate, and the module's segregation of duties.

    Approves every row that is pending. A **withheld** row is approved too and
    stays withheld: §5.6 makes withholding a hold on *publication*, not a
    refusal to approve, and leaving it unapproved would block the exam's own
    status transition over one student.
    """
    exam = lock_exam(exam)
    if exam.status != ExamStatus.PROCESSING:
        raise Conflict(
            f"This exam is {exam.get_status_display().lower()}. Only processed results can "
            "be approved."
        )

    pending = list(
        Result.objects.alive()
        .select_for_update()
        .filter(exam=exam, status=ResultStatus.PENDING_APPROVAL)
    )
    if not pending:
        raise Conflict("There are no processed results awaiting approval on this exam.")

    assert_approver_is_not_the_processor(results=pending, approver_id=approver_id)

    now = timezone.now()
    for row in pending:
        row.status = ResultStatus.APPROVED
        row.approved_by = approver_id
        row.approved_at = now
        row.updated_by = approver_id
    Result.objects.bulk_update(
        pending,
        ["status", "approved_by", "approved_at", "updated_by"],
        batch_size=500,
    )

    exam.status = ExamStatus.APPROVED
    exam.updated_by = approver_id
    exam.save(update_fields=["status", "updated_by", "updated_at"])
    return {"approved": len(pending)}


@transaction.atomic
def send_results_back(*, exam: Exam, actor_id: uuid.UUID, reason: str) -> dict:
    """§7.1's "changes requested" edge — return an exam to marks entry.

    The only way out of `approved`, and the reason both `assert_exam_accepts_marks`
    and `assert_exam_is_recomputable` can be strict: without this, a data-entry
    error found at approval would have no route back and someone would reach for
    a database edit.

    Rows return to `processing`, not `pending_approval`: they are no longer
    awaiting a decision, and leaving them pending would keep the exam in an
    approver's queue while its marks are being changed underneath them.
    """
    exam = lock_exam(exam)
    if exam.status not in (ExamStatus.PROCESSING, ExamStatus.APPROVED):
        raise Conflict(
            f"This exam is {exam.get_status_display().lower()}, so there are no results to "
            "send back."
        )

    reopened = (
        Result.objects.alive()
        .filter(exam=exam)
        .exclude(status=ResultStatus.PUBLISHED)
        .update(
            status=ResultStatus.PROCESSING,
            approved_by=None,
            approved_at=None,
            updated_by=actor_id,
            updated_at=timezone.now(),
        )
    )
    exam.status = ExamStatus.MARKS_ENTRY
    exam.updated_by = actor_id
    exam.save(update_fields=["status", "updated_by", "updated_at"])
    return {"reopened": reopened, "reason": reason}


@transaction.atomic
def withhold_result(*, result: Result, reason: str, actor_id: uuid.UUID) -> Result:
    """§5.6 — "withheld results supported per student".

    An `outcome`, not a separate flag, so a withheld result is excluded from
    publishing by the same query that includes everything else rather than by a
    condition each caller has to remember.

    Refused once published: the result is already with the student, and the
    remedy then is a correction, not a retroactive hold.
    """
    # The row, not the exam: withholding is per student, and locking the exam
    # would serialise every guardian's hold against every other one.
    result = Result.objects.select_for_update().get(pk=result.pk)
    if result.status == ResultStatus.PUBLISHED:
        raise Conflict(
            "This result is already published, so it cannot be withheld. Reprocess the exam "
            "to correct it."
        )
    result.outcome = ResultOutcome.WITHHELD
    result.updated_by = actor_id
    result.save(update_fields=["outcome", "updated_by", "updated_at"])
    return result


@transaction.atomic
def publish_exam_results(*, exam: Exam, actor_id: uuid.UUID) -> dict:
    """§5.6 — release approved results to students and guardians.

    **Only approved rows, and never a withheld one.** Both are the point of the
    action: publishing an unapproved result bypasses the gate §4 puts a separate
    key on, and publishing a withheld one undoes a decision someone took about
    one student.

    Idempotent, and it reports how many rows *moved*. §12's notification fires
    on that count rather than on the exam's status, which is the bug
    `attendance`'s review found: alerting on current state re-sent every
    guardian the same message on every retry.
    """
    exam = lock_exam(exam)
    if exam.status not in (ExamStatus.APPROVED, ExamStatus.PUBLISHED):
        raise Conflict(
            f"This exam is {exam.get_status_display().lower()}. Only approved results can be "
            "published."
        )

    publishable = list(
        Result.objects.alive()
        .select_for_update()
        .filter(exam=exam, status=ResultStatus.APPROVED)
        .exclude(outcome=ResultOutcome.WITHHELD)
    )
    withheld = Result.objects.alive().filter(exam=exam, outcome=ResultOutcome.WITHHELD).count()

    now = timezone.now()
    for row in publishable:
        row.status = ResultStatus.PUBLISHED
        row.published_at = now
        row.updated_by = actor_id
    if publishable:
        Result.objects.bulk_update(
            publishable, ["status", "published_at", "updated_by"], batch_size=500
        )

    exam.status = ExamStatus.PUBLISHED
    exam.updated_by = actor_id
    exam.save(update_fields=["status", "updated_by", "updated_at"])
    return {
        "published": len(publishable),
        "withheld": withheld,
        # The ids that actually **transitioned**, returned rather than left for
        # the caller to pre-collect. Review found the view collecting them
        # *before* calling this — outside the lock — so two concurrent
        # publishes could each schedule §12's guardian notification for the same
        # rows. Only the winner's list is non-empty now.
        "published_ids": [str(row.pk) for row in publishable],
    }


# --- §5.7 report cards ----------------------------------------------------


def assert_report_cards_are_generatable(exam: Exam) -> None:
    """§11 — "report cards only from published results".

    A card carries a grade and a rank, so generating one before publication
    would put a figure in a parent's hands that a school has not yet released —
    and §5.6's whole point is that releasing is a separate, permissioned act.
    """
    if exam.status != ExamStatus.PUBLISHED:
        raise Conflict(
            f"This exam is {exam.get_status_display().lower()}. Report cards are generated "
            "from published results (§11)."
        )


def attendance_summary_for(*, students: list, start_date, end_date) -> dict:
    """§5.7's attendance figures, for every student in one call.

    Reads `apps.attendance.reports.student_summary` — the same query §13's own
    attendance report uses, so a report card and an attendance report cannot
    disagree about the same child.

    **Called once for the whole cohort, not per student.** The report function
    takes a queryset and groups in SQL, which is exactly the property that makes
    a batch call possible; asking per student would be the N+1 that module's
    own docstring warns about.

    Returns `{student_id: {...}}`. A student with no register rows is absent
    from the mapping rather than present with zeros — a school that has not kept
    attendance has no figure, and printing 0% attended would be a claim the data
    does not support.
    """
    from apps.attendance.models import StudentAttendance
    from apps.attendance.reports import student_summary

    rows = student_summary(
        StudentAttendance.objects.alive().filter(student__in=students),
        start_date=start_date,
        end_date=end_date,
    )
    return {
        row["student_id"]: {
            "present_days": row["present_days"],
            "counted_days": row["counted_days"],
            "absent_days": row["absent_days"],
            "late_days": row["late_days"],
            "attendance_rate": str(row["attendance_rate"]),
        }
        for row in rows
    }


def report_card_period(*, exam: Exam) -> tuple:
    """The date range a card's attendance summary covers.

    The exam's term where it has one, else the session. Not the exam's own
    dates: §5.7 wants the attendance a report card reports on, and a parent
    reading one expects the term's figure rather than the three days of an exam
    week.
    """
    # Bound and checked, not `term_id is not None`: the FK is what carries the
    # dates, and narrowing on the id leaves the attribute access unguarded.
    term = exam.term
    if term is not None:
        return term.start_date, term.end_date
    return exam.academic_session.start_date, exam.academic_session.end_date


@transaction.atomic
def upsert_report_card(*, exam: Exam, result: Result, summary: dict | None, actor_id: uuid.UUID):
    """One student's card row, versioned rather than duplicated.

    §6 asks for "regeneration versioning": a school that reissues a card after
    fixing a remark needs the previous one to stop being current without the
    record of it vanishing. So a regeneration bumps `version` and clears the
    stale `file`, and the render job fills a new one in.

    `summary` is nullable, and the signature says so: a student with no register
    rows has no attendance figure, and the body already stores `None` for them —
    the annotation had claimed otherwise.

    Remarks are **preserved** across a regeneration. They are a class teacher's
    and a principal's own words, and a regeneration triggered by a marks
    correction has nothing to say about them — losing them would make anyone
    who had written remarks reluctant to regenerate at all.
    """
    existing = ReportCard.objects.alive().filter(exam=exam, student_id=result.student_id).first()
    if existing is None:
        return ReportCard.objects.create(
            tenant=exam.tenant,
            exam=exam,
            student_id=result.student_id,
            result=result,
            attendance_summary=summary or None,
            status=ReportCardStatus.DRAFT,
            created_by=actor_id,
            updated_by=actor_id,
        )

    if existing.status == ReportCardStatus.PUBLISHED:
        existing.version += 1
    existing.result = result
    existing.attendance_summary = summary or None
    existing.file = None
    existing.status = ReportCardStatus.DRAFT
    existing.updated_by = actor_id
    existing.save(
        update_fields=[
            "version",
            "result",
            "attendance_summary",
            "file",
            "status",
            "updated_by",
            "updated_at",
        ]
    )
    return existing


@transaction.atomic
def publish_report_cards(*, exam: Exam, actor_id: uuid.UUID) -> dict:
    """§5.7 — release generated cards to the portals.

    Only cards that have a rendered file. A `draft` card with no document is a
    row waiting on the render job, and publishing it would put a link in a
    parent's portal that resolves to nothing.
    """
    ready = list(
        ReportCard.objects.alive()
        .select_for_update()
        .filter(exam=exam, status=ReportCardStatus.GENERATED, file__isnull=False)
    )
    if not ready:
        raise Conflict(
            "No report cards have finished rendering for this exam yet. Poll the generation "
            "job before publishing."
        )

    now = timezone.now()
    for card in ready:
        card.status = ReportCardStatus.PUBLISHED
        card.published_at = now
        card.updated_by = actor_id
    ReportCard.objects.bulk_update(ready, ["status", "published_at", "updated_by"], batch_size=500)
    # Same reasoning as `publish_exam_results`: the caller notifies on what
    # moved, and only this function knows that under the lock.
    return {"published": len(ready), "published_ids": [str(card.pk) for card in ready]}


# --- §5.8 question banks and paper assembly -------------------------------


def assert_question_is_approvable(question: Question) -> None:
    """§7.2 — the gate AI output passes through.

    An already-approved question is a no-op rather than a conflict: pressing
    approve twice is a retry. What is refused is approving a *manual* question,
    because there is nothing to approve — `is_approved` is already true, and
    offering the action would suggest a gate that is not there.
    """
    if question.source != QuestionSource.AI_GENERATED:
        raise Conflict(
            "Only AI-generated questions go through approval. A question a teacher wrote is "
            "usable as soon as it is saved."
        )


@transaction.atomic
def approve_question(*, question: Question, actor_id: uuid.UUID) -> Question:
    """§7.2 — a human puts their name to an AI draft.

    AGENTS.md invariant 5 in one function: no AI output reaches a student
    without a permission-gated human approval, and `approved_by` is what makes
    that auditable rather than merely asserted.
    """
    assert_question_is_approvable(question)
    if question.is_approved:
        return question
    question.is_approved = True
    question.approved_by = actor_id
    question.updated_by = actor_id
    question.save(update_fields=["is_approved", "approved_by", "updated_by", "updated_at"])
    return question


def assert_blueprint_is_satisfiable(*, bank: QuestionBank, sections: list[dict]) -> list[dict]:
    """§6 — assemble a paper "by difficulty/topic blueprint".

    Returns the shortfalls rather than raising, so the caller can report **all**
    of them at once. A teacher whose blueprint asks for eight hard questions
    from a bank holding three needs to know that about every section of the
    paper, not to fix one and resubmit.

    Only **approved** questions count. An unapproved AI draft is not available
    to a paper by definition (§7.2), and counting it would make a blueprint look
    satisfiable and then assemble a paper that is short.
    """
    available = (
        Question.objects.alive()
        .filter(question_bank=bank, is_approved=True)
        .values_list("pk", "difficulty", "topic")
    )
    pool: dict = {}
    for pk, difficulty, topic in available:
        pool.setdefault((difficulty, topic), []).append(pk)
        pool.setdefault((difficulty, None), []).append(pk)

    shortfalls = []
    for index, section in enumerate(sections):
        difficulty = section["difficulty"]
        topic = section.get("topic")
        count = section["count"]
        # A section naming no topic draws from every topic at that difficulty;
        # one naming a topic draws only from it. That is the narrower claim, so
        # it gets the narrower pool.
        have = len(pool.get((difficulty, topic), []))
        if have < count:
            shortfalls.append(
                {
                    "index": index,
                    "difficulty": difficulty,
                    "topic": topic,
                    "requested": count,
                    "available": have,
                }
            )
    return shortfalls


def select_paper_questions(*, bank: QuestionBank, sections: list[dict]) -> list[dict]:
    """Pick the questions a blueprint asks for. **Deterministic** — no randomness.

    Ordered by `usage_count` then creation, so the least-used approved question
    is chosen first. That is a real property rather than an arbitrary one: it
    spreads reuse across a bank, which is what makes §6's usage tracking worth
    keeping, and it means two assemblies of the same blueprint over an unchanged
    bank produce the same paper — so a teacher who regenerates after a typo does
    not get a different exam.

    A question already taken by an earlier section is not offered again: a paper
    with the same question twice is a paper somebody has to reprint.
    """
    taken: set = set()
    chosen: list[dict] = []

    for section in sections:
        difficulty = section["difficulty"]
        topic = section.get("topic")
        candidates = (
            Question.objects.alive()
            .filter(question_bank=bank, is_approved=True, difficulty=difficulty)
            .exclude(pk__in=taken)
        )
        if topic:
            candidates = candidates.filter(topic=topic)
        picked = list(candidates.order_by("usage_count", "created_at")[: section["count"]])
        taken.update(question.pk for question in picked)
        chosen.append(
            {
                "title": section.get("title") or f"Section {len(chosen) + 1}",
                "questions": picked,
                "marks_each": section.get("marks_each"),
            }
        )
    return chosen


@transaction.atomic
def record_paper_usage(*, questions: list, actor_id: uuid.UUID) -> int:
    """§6's usage tracking — one `bulk_update`, never a save per question.

    Incremented rather than derived because §15 records that assembled papers
    are stored as files with **no table** to join against, so there is nothing
    to count from. That makes this column the only record that a question was
    used, which is why it is written in the same transaction as the assembly.
    """
    if not questions:
        return 0
    for question in questions:
        question.usage_count += 1
        question.updated_by = actor_id
    Question.objects.bulk_update(questions, ["usage_count", "updated_by"], batch_size=500)
    return len(questions)


# --- §13's reports --------------------------------------------------------

# Past this many rows the endpoint hands the caller a job instead of building
# the report inline. The same ceiling `attendance` uses, and for the same
# reason: a term-scale register is not a request anyone should hold open.
SYNCHRONOUS_REPORT_ROW_LIMIT = 1000


def assert_report_kind(kind: str) -> None:
    if kind not in reports.REPORT_KINDS:
        raise DomainRuleViolation(
            {
                "kind": (
                    f"Unknown report {kind!r}. Available: " + ", ".join(reports.REPORT_KINDS) + "."
                )
            }
        )


def build_report_rows(*, kind: str, exam_id, user, limit: int | None = None) -> list[dict]:
    """Build one §13 report's rows under `user`'s record scope.

    Shared by the endpoint and the export job so the two can never disagree —
    which matters more here than usual, because a principal reads the inline
    report and the exported spreadsheet as the same document.

    `limit` caps how many rows are *materialised*, so the endpoint can decide
    "inline or job?" without paying for the answer: it asks for one more row
    than the synchronous ceiling, and getting that many back is enough to know.
    Checking the threshold after building the whole thing is precisely the cost
    the 202-and-a-job pattern exists to avoid — the mistake `attendance`'s
    review caught there.

    **The scope is applied here, from the user**, not by the caller. A report is
    read as authoritative, so an export must not widen what its requester could
    see inline.
    """
    from core.rbac.permissions import scope_queryset

    assert_report_kind(kind)

    if kind == "question-bank-usage":
        scoped = scope_queryset(QuestionBank.objects.alive(), user, campus_field=None)
        return reports.question_bank_usage(scoped, limit=limit)

    if kind in ("subject-performance", "marks-entry-status"):
        scoped = scope_queryset(Marks.objects.alive(), user, campus_field="student__campus_id")
        builder = (
            reports.subject_performance
            if kind == "subject-performance"
            else reports.marks_entry_status
        )
        return builder(scoped, exam_id=exam_id, limit=limit)

    scoped = scope_queryset(Result.objects.alive(), user, campus_field="student__campus_id")
    if kind == "result-register":
        return reports.result_register(scoped, exam_id=exam_id, limit=limit)
    if kind == "pass-fail-analysis":
        return reports.pass_fail_analysis(scoped, exam_id=exam_id, limit=limit)
    return reports.grade_distribution(scoped, exam_id=exam_id, limit=limit)
