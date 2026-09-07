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

from django.db import transaction

from apps.examinations import conflicts, grading
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
