"""Factories for the examinations tests.

See school_organization/tests/factories.py's module docstring for why every
factory writes through the tenant-scoped default manager inside
``tenant_context(...)``.

Factories owned by other modules are re-exported here rather than imported per
test file, matching attendance/tests/factories.py: an exam means nothing without
a session, a class, a subject, students enrolled in a section, and a teacher
allocated to the class-subject whose marks they will enter — and having each
test file assemble that import list itself is how fixtures drift apart.

`complete_scale` is the piece worth knowing about. §11 requires a grading
scale's bands to cover 0-100% with no gap or overlap, and
`grading.assert_scale_is_complete` refuses a scale that does not before an exam
may use it. A fixture that built bands ad hoc would therefore fail on the scale
rather than on whatever a test was asserting, so there is one helper that
produces a valid scale and every test starts from it.
"""

from __future__ import annotations

import datetime
from decimal import Decimal

import factory

from apps.academics.tests.factories import TeacherAllocationFactory
from apps.examinations.models import (
    AdmitCard,
    AdmitCardStatus,
    Exam,
    ExamSchedule,
    ExamStatus,
    ExamSubject,
    ExamType,
    GradeBand,
    GradingScale,
    Marks,
    MarksStatus,
    Question,
    QuestionBank,
    QuestionDifficulty,
    QuestionType,
    ReportCard,
    Result,
    ResultOutcome,
    ScaleType,
    ScheduleStatus,
)
from apps.school_organization.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    ClassSubjectFactory,
    SectionFactory,
    SubjectFactory,
    TenantFactory,
    TermFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.staff_management.tests.factories import StaffFactory
from apps.student_management.tests.factories import (
    GuardianFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    StudentGuardianFactory,
)
from apps.timetable.tests.factories import RoomFactory, enable_feature
from core.tenancy.context import tenant_context
from core.tenancy.models import FeatureFlag, TenantFeatureOverride

__all__ = [
    "AFTERNOON",
    "MORNING",
    "STANDARD_BANDS",
    "AcademicSessionFactory",
    "CampusFactory",
    "ClassFactory",
    "ClassSubjectFactory",
    "ExamFactory",
    "AdmitCardFactory",
    "ExamScheduleFactory",
    "ExamSubjectFactory",
    "GradeBandFactory",
    "MarksFactory",
    "QuestionBankFactory",
    "QuestionFactory",
    "ReportCardFactory",
    "ResultFactory",
    "GradingScaleFactory",
    "GuardianFactory",
    "RoomFactory",
    "SectionFactory",
    "StaffFactory",
    "StudentEnrollmentFactory",
    "StudentFactory",
    "StudentGuardianFactory",
    "SubjectFactory",
    "TeacherAllocationFactory",
    "TenantFactory",
    "TermFactory",
    "UserFactory",
    "authenticate",
    "complete_scale",
    "disable_feature",
    "exam_week",
    "open_marks_entry",
    "enable_feature",
    "grant",
]

# A conventional five-band letter scale that satisfies §11: contiguous to two
# decimal places, no overlap, 0 through 100. The seams are `.99`/`.00` rather
# than whole numbers because `NUMERIC(5,2)` can store 79.5, so bands ending at
# 79 and starting at 80 would leave it ungraded — which is exactly the gap
# `assert_scale_is_complete` refuses, and exactly the mistake a fixture would
# otherwise bake in.
#
# (label, min_percent, max_percent, grade_point, is_passing)
STANDARD_BANDS = (
    ("A", "80.00", "100.00", "4.00", True),
    ("B", "70.00", "79.99", "3.00", True),
    ("C", "60.00", "69.99", "2.00", True),
    ("D", "50.00", "59.99", "1.00", True),
    ("F", "0.00", "49.99", "0.00", False),
)


class GradingScaleFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = GradingScale

    name = factory.Sequence(lambda n: f"Scale {n}")
    scale_type = ScaleType.HYBRID
    gpa_max = Decimal("4.00")
    is_default = False


class GradeBandFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = GradeBand

    label = factory.Sequence(lambda n: f"B{n}")
    min_percent = Decimal("0.00")
    max_percent = Decimal("100.00")
    is_passing = True
    # No SubFactory for `grading_scale`: it must belong to the same tenant, so
    # callers wire it explicitly — the convention every factory here follows.


def complete_scale(tenant, *, bands=STANDARD_BANDS, **scale_kwargs) -> GradingScale:
    """A grading scale whose bands actually satisfy §11.

    Returns the scale with `.bands` already written, so a caller can hand it
    straight to an exam. Called inside `tenant_context` by the caller, matching
    every other factory here.
    """
    scale = GradingScaleFactory(tenant=tenant, **scale_kwargs)
    for order, (label, low, high, point, passing) in enumerate(bands):
        GradeBandFactory(
            tenant=tenant,
            grading_scale=scale,
            label=label,
            min_percent=Decimal(low),
            max_percent=Decimal(high),
            grade_point=Decimal(point) if point is not None else None,
            is_passing=passing,
            sort_order=order,
        )
    return scale


class ExamFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Exam

    name = factory.Sequence(lambda n: f"Exam {n}")
    exam_type = ExamType.MIDTERM
    weightage_percent = Decimal("100.00")
    status = ExamStatus.DRAFT
    # No SubFactory for session/term/grading_scale: all three must belong to the
    # same tenant, and the scale must be *complete* — see `complete_scale`.


class ExamSubjectFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = ExamSubject

    max_marks = Decimal("100.00")
    pass_marks = Decimal("40.00")
    has_practical = False
    subject_weightage_percent = Decimal("100.00")


def disable_feature(tenant, key: str) -> None:
    """Force `key` off for `tenant`, so the module gate can be asserted.

    The mirror of `enable_feature`, which the base fixture calls in `setUp` —
    a test asserting the gate has to undo that rather than skip it, because a
    fixture that never enabled the module would fail every *other* assertion
    for the same reason and prove nothing about the gate.

    Note the field is `enabled`, not `is_enabled`, and `FeatureFlag` has only
    the plain `objects` manager: the flag catalogue is platform-level, not
    tenant-owned, and it is the *override* that carries the tenant.
    """
    flag = FeatureFlag.objects.get(key=key)
    with tenant_context(tenant.id):
        TenantFeatureOverride.objects.update_or_create(
            tenant=tenant,
            feature_flag=flag,
            defaults={"enabled": False, "reason": "examinations feature-gate test"},
        )


# One ordinary exam morning: a two-hour paper, then a second slot that does not
# touch it. Fixed times rather than derived from `now()` so a test asserting an
# overlap is asserting arithmetic, not the hour CI happens to run at.
MORNING = (datetime.time(9, 0), datetime.time(11, 0))
AFTERNOON = (datetime.time(13, 0), datetime.time(15, 0))


class ExamScheduleFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = ExamSchedule

    start_time = MORNING[0]
    end_time = MORNING[1]
    status = ScheduleStatus.SCHEDULED
    # No SubFactory for exam_subject/section/room/invigilator: each must belong
    # to the same tenant and agree with the others (the section must be in the
    # exam-subject's class), so callers wire them explicitly — the convention
    # every factory here follows. `exam_date` likewise: a sitting outside its
    # exam's own window is a *conflict* the engine reports, and a factory
    # default would produce it silently.


class AdmitCardFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = AdmitCard

    admit_card_no = factory.Sequence(lambda n: f"TEST-{n:06d}")
    status = AdmitCardStatus.GENERATED


def exam_week(tenant, exam, *, days: int = 5):
    """Give `exam` a date window starting on the next working day.

    Derived from the calendar rather than hardcoded because `conflicts` reports
    a sitting on a weekend or holiday as a **hard** finding: a fixture pinned to
    a fixed date would fail on the calendar two days in seven, which is the
    flakiness `attendance`'s `MARKING_DATE` comment already warns about.
    """
    from django.utils import timezone

    from apps.school_organization import calendar

    with tenant_context(tenant.id):
        day = timezone.localdate()
        for _ in range(14):
            if calendar.is_working_day(day):
                break
            day += datetime.timedelta(days=1)
        exam.starts_on = day
        exam.ends_on = day + datetime.timedelta(days=days)
        exam.save(update_fields=["starts_on", "ends_on", "updated_at"])
    return day


class MarksFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Marks

    status = MarksStatus.DRAFT
    is_absent = False
    is_exempt = False
    # No SubFactory for exam_subject/student: both must belong to the same
    # tenant and the student must be enrolled in a class the exam-subject
    # covers, so callers wire them explicitly. `entered_by` is a plain UUID
    # column, so callers pass a real user's pk.


def open_marks_entry(exam_subject, *, opens_at=None, closes_at=None) -> None:
    """Put an exam-subject's entry window around now, so marks can be entered.

    A window is optional on the model — unset means always open — but a test
    asserting the *window* needs one that is actually current, and computing it
    from `timezone.now()` at each call site is how two tests end up disagreeing
    about what "open" means.
    """
    from django.utils import timezone

    now = timezone.now()
    with tenant_context(exam_subject.tenant_id):
        exam_subject.marks_entry_opens_at = opens_at or (now - datetime.timedelta(days=1))
        exam_subject.marks_entry_closes_at = closes_at or (now + datetime.timedelta(days=1))
        exam_subject.save(
            update_fields=["marks_entry_opens_at", "marks_entry_closes_at", "updated_at"]
        )


class ResultFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Result

    total_max_marks = Decimal("100.00")
    total_obtained_marks = Decimal("60.00")
    percentage = Decimal("60.00")
    outcome = ResultOutcome.PASS
    # No SubFactory for exam/student/section: all three must belong to the same
    # tenant and agree with each other, so callers wire them explicitly.


class ReportCardFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = ReportCard

    version = 1


class QuestionBankFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = QuestionBank

    name = factory.Sequence(lambda n: f"Bank {n}")
    # No SubFactory for subject/class: both must belong to the same tenant.


class QuestionFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Question

    question_text = factory.Sequence(lambda n: f"What is the answer to question {n}?")
    question_type = QuestionType.SHORT_ANSWER
    difficulty = QuestionDifficulty.MEDIUM
    default_marks = Decimal("2.00")
    # `short_answer` by default, so the options CHECK does not force every
    # caller to supply choices it does not care about. A test about MCQs sets
    # both the type and the options together, which is the pairing the
    # constraint exists to enforce.
