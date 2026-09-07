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

import factory
from django.utils import timezone

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
from core.tenancy.context import tenant_context
from core.tenancy.models import TenantSettings

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
    "configure_academic",
    "enable_feature",
    "grant",
    "holiday",
    "open_all_week",
]

# **Today**, not a fixed date. §5.5 locks a register at the end of its marking
# day, so a fixture pinned to any past date arrives already locked and every
# re-submission test would fail on the lock rather than on what it asserts.
#
# Today is whatever weekday CI happens to run on, which is why every fixture also
# calls `open_all_week` — the calendar's real Mon-Fri default is asserted in
# school_organization's own test_calendar.py, and re-asserting it here by
# accident, on two days in seven, would only make these tests flaky.
MARKING_DATE = timezone.localdate()


def configure_academic(tenant, **keys) -> None:
    """Merge keys into the tenant's academic settings, leaving the rest alone.

    Merge rather than replace: a test that sets a holiday must not silently drop
    the working week the fixture depends on, which is exactly the kind of
    coupling that makes a fixture fail on Saturdays only.
    """
    with tenant_context(tenant.id):
        row, _ = TenantSettings.objects.get_or_create(tenant=tenant)
        row.academic = {**(row.academic or {}), **keys}
        row.save(update_fields=["academic", "updated_at"])


def open_all_week(tenant) -> None:
    """Configure the tenant to operate seven days a week.

    See MARKING_DATE: the fixtures mark today, and today is not always a weekday.
    """
    configure_academic(tenant, working_days=[0, 1, 2, 3, 4, 5, 6])


def holiday(start: str, name: str, end: str | None = None, campus_id=None) -> dict:
    """One entry in the stored holiday shape (school_organization/calendar.py)."""
    entry = {"start_date": start, "end_date": end or start, "name": name}
    if campus_id is not None:
        entry["campus_id"] = str(campus_id)
    return entry


class StudentAttendanceFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = StudentAttendance

    attendance_date = factory.LazyFunction(timezone.localdate)
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
