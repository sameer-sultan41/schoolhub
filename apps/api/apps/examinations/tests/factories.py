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

from decimal import Decimal

import factory

from apps.academics.tests.factories import TeacherAllocationFactory
from apps.examinations.models import (
    Exam,
    ExamStatus,
    ExamSubject,
    ExamType,
    GradeBand,
    GradingScale,
    ScaleType,
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

__all__ = [
    "STANDARD_BANDS",
    "AcademicSessionFactory",
    "CampusFactory",
    "ClassFactory",
    "ClassSubjectFactory",
    "ExamFactory",
    "ExamSubjectFactory",
    "GradeBandFactory",
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
