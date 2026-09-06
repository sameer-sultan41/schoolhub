"""Factories for the attendance tests.

See school_organization/tests/factories.py's module docstring for why every
factory writes through the tenant-scoped default manager inside
``tenant_context(...)``.

The factories that belong to other modules are re-exported here rather than
imported per test file, matching timetable/tests/factories.py: an attendance row
needs a student, an enrollment, a section, a session and a class teacher before
it means anything, and having each test assemble that import list itself is how
the fixtures drift apart.
"""

from __future__ import annotations

import datetime

import factory

from apps.attendance.models import (
    AttendanceCorrection,
    AttendanceSource,
    AttendanceStatus,
    CorrectionStatus,
    CorrectionSubjectType,
    StudentAttendance,
)
from apps.school_organization.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    SectionFactory,
    SubjectFactory,
    TenantFactory,
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
from apps.timetable.tests.factories import PeriodFactory, enable_feature

__all__ = [
    "AcademicSessionFactory",
    "AttendanceCorrectionFactory",
    "CampusFactory",
    "ClassFactory",
    "GuardianFactory",
    "MARKING_DATE",
    "PeriodFactory",
    "SectionFactory",
    "StaffFactory",
    "StudentAttendanceFactory",
    "StudentEnrollmentFactory",
    "StudentFactory",
    "StudentGuardianFactory",
    "SubjectFactory",
    "TenantFactory",
    "UserFactory",
    "authenticate",
    "enable_feature",
    "grant",
]

# A Monday inside AcademicSessionFactory's default 2026-04-01 .. 2027-03-31
# window. Monday matters: `calendar.DEFAULT_WORKING_DAYS` is Mon-Fri, so a
# fixture dated on a weekend would be refused by §11's own gate and every
# marking test would fail for a reason unrelated to what it asserts.
MARKING_DATE = datetime.date(2026, 4, 6)


class StudentAttendanceFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = StudentAttendance

    attendance_date = MARKING_DATE
    status = AttendanceStatus.PRESENT
    source = AttendanceSource.MANUAL
    is_locked = False
    # No SubFactory defaults for student/section/academic_session/period: each
    # must belong to the same tenant and agree with the others (the section is
    # the one the student is enrolled in), so callers wire them explicitly —
    # the convention StudentEnrollmentFactory and TimetableSlotFactory set.
    # `marked_by` is a plain UUID column, so callers pass a real user's pk.


class AttendanceCorrectionFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = AttendanceCorrection

    subject_type = CorrectionSubjectType.STUDENT
    status = CorrectionStatus.PENDING
    reason = "Marked absent in error; the student was in the science lab."
    old_values = factory.LazyFunction(lambda: {"status": AttendanceStatus.ABSENT.value})
    new_values = factory.LazyFunction(lambda: {"status": AttendanceStatus.PRESENT.value})
