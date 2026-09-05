"""Factories for the timetable tests.

See school_organization/tests/factories.py's module docstring for why every
factory writes through the tenant-scoped default manager inside
``tenant_context(...)``.
"""

from __future__ import annotations

import datetime

import factory

from apps.academics.tests.factories import TeacherAllocationFactory
from apps.school_organization.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    ClassSubjectFactory,
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
from apps.timetable.models import (
    Period,
    Room,
    RoomType,
    SlotStatus,
    SubstitutionStatus,
    TeacherSubstitution,
    TimetableSlot,
)
from core.tenancy.models import FeatureFlag, TenantFeatureOverride

# Inside AcademicSessionFactory's default 2026-04-01 .. 2027-03-31 window, and a
# Monday — `day_of_week=0` on TimetableSlotFactory means Monday while the tenant
# week-start setting does not exist (services._slot_weekday).
MONDAY = datetime.date(2026, 4, 6)
TUESDAY = datetime.date(2026, 4, 7)


def period_window(sequence: int) -> tuple[datetime.time, datetime.time]:
    """A 45-minute window derived from the period's place in the day.

    Derived rather than fixed so periods created with adjacent sequences really
    do adjoin — `conflicts._consecutive_load` measures a run on `sequence`, and a
    fixture whose times contradicted its sequences would make those tests lie.

    Wraps at 12 so a long test run's global factory counter cannot produce an
    invalid hour; a tenant with more than twelve periods in a day would collide,
    which is why every test that cares passes `sequence` explicitly.
    """
    hour = 6 + (sequence % 12)
    return datetime.time(hour=hour), datetime.time(hour=hour, minute=45)


class RoomFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Room

    name = factory.Sequence(lambda n: f"Room {n}")
    code = factory.Sequence(lambda n: f"R{n:04d}")
    room_type = RoomType.CLASSROOM
    capacity = 40
    is_active = True
    # No SubFactory default for `campus`: it must belong to the same tenant as
    # the room, so callers pass an already-created, correctly-tenanted Campus —
    # the convention StaffFactory and StudentFactory already set.


class PeriodFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Period

    name = factory.LazyAttribute(lambda o: f"Period {o.sequence}")
    sequence = factory.Sequence(lambda n: n + 1)
    start_time = factory.LazyAttribute(lambda o: period_window(o.sequence)[0])
    end_time = factory.LazyAttribute(lambda o: period_window(o.sequence)[1])
    is_break = False
    # `campus` left unset means null, which the model reads as "every campus" —
    # the shape most fixtures want, because a campus-bound period would trip the
    # engine's `period_wrong_campus` finding on every slot in another campus.


class TimetableSlotFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = TimetableSlot

    day_of_week = 0
    status = SlotStatus.DRAFT
    # No SubFactory defaults: session/section/period/subject/staff/room must all
    # belong to the same tenant and agree with each other (a slot's teacher needs
    # an allocation for its section and subject, or the engine reports it), so
    # callers wire them explicitly.


class TeacherSubstitutionFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = TeacherSubstitution

    date = MONDAY
    status = SubstitutionStatus.PROPOSED
    # Derived, never passed: `period` is a copy of the slot's own period (models.py
    # argues for the column), so a fixture free to set it independently could
    # write a row `create_substitution` can never produce — and the two occupancy
    # constraints would then look wrong in a test that is really lying about its
    # data.
    period = factory.LazyAttribute(lambda o: o.timetable_slot.period)


def enable_feature(tenant, key: str) -> None:
    """Force ``key`` on for ``tenant``, regardless of its coded default.

    `module.timetable` ships `default_enabled=False` (features.py), so without
    this every request in these tests would be refused with `module_disabled`
    before reaching the code under test.

    `update_or_create`, not `get_or_create`: an existing `enabled=False` row
    would otherwise stick and the test would fail on a disabled module rather
    than on what it meant to assert.
    """
    from core.tenancy.context import tenant_context

    flag = FeatureFlag.objects.get(key=key)
    with tenant_context(tenant.id):
        TenantFeatureOverride.objects.update_or_create(
            tenant=tenant,
            feature_flag=flag,
            defaults={"enabled": True, "reason": "timetable test fixture"},
        )


__all__ = [
    "MONDAY",
    "TUESDAY",
    "AcademicSessionFactory",
    "CampusFactory",
    "ClassFactory",
    "ClassSubjectFactory",
    "GuardianFactory",
    "PeriodFactory",
    "RoomFactory",
    "SectionFactory",
    "StaffFactory",
    "StudentEnrollmentFactory",
    "StudentFactory",
    "StudentGuardianFactory",
    "SubjectFactory",
    "TeacherAllocationFactory",
    "TeacherSubstitutionFactory",
    "TenantFactory",
    "TimetableSlotFactory",
    "UserFactory",
    "authenticate",
    "enable_feature",
    "grant",
    "period_window",
]
