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

from apps.examinations import grading
from apps.examinations.models import (
    Exam,
    ExamStatus,
    GradeBand,
    GradingScale,
)
from apps.school_organization.models import AcademicSession, Class, ClassSubject, Subject, Term
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
