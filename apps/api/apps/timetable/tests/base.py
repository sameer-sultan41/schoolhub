"""Shared setup for the timetable tests.

Builds the minimum structure a timetable cell is meaningful inside: a *current*
session, a class, a section, a subject in that class's curriculum, a teaching
staff member **allocated** to that section and subject, four adjacent periods and
a room.

The allocation is not optional scenery. `conflicts._unallocated_teachers` is a
*hard* finding, so a fixture without it would report a conflict on every slot and
every publish test would fail for a reason unrelated to what it asserts. The
session is `is_current=True` for the same kind of reason: `:validate`, `:publish`
and `/timetables/my` all fall back to the current session when the caller names
none, and there would be nothing to fall back to.
"""

from __future__ import annotations

from rest_framework.test import APITestCase

from apps.timetable.models import SlotStatus, TimetableSlot
from apps.timetable.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    ClassSubjectFactory,
    PeriodFactory,
    RoomFactory,
    SectionFactory,
    StaffFactory,
    SubjectFactory,
    TeacherAllocationFactory,
    TenantFactory,
    TimetableSlotFactory,
    UserFactory,
    authenticate,
    enable_feature,
    grant,
)
from core.tenancy.context import tenant_context


class TimetableAPITestCase(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)
        enable_feature(self.tenant, "module.timetable")

        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.session = AcademicSessionFactory(tenant=self.tenant, is_current=True)
            self.school_class = ClassFactory(tenant=self.tenant, level=6)
            self.section = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=self.campus
            )
            self.other_section = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=self.campus
            )
            self.subject = SubjectFactory(tenant=self.tenant)
            self.curriculum = ClassSubjectFactory(
                tenant=self.tenant,
                academic_session=self.session,
                school_class=self.school_class,
                subject=self.subject,
            )
            self.teacher = StaffFactory(tenant=self.tenant, campus=self.campus)
            self.allocation = TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=self.section,
                subject=self.subject,
                staff=self.teacher,
            )
            self.periods = [
                PeriodFactory(tenant=self.tenant, sequence=sequence) for sequence in (1, 2, 3, 4)
            ]
            self.period = self.periods[0]
            self.room = RoomFactory(tenant=self.tenant, campus=self.campus, capacity=40)

    # ---- helpers ----------------------------------------------------------

    def allow(self, *keys: str) -> None:
        grant(self.user, *keys)

    def allow_everything(self) -> None:
        """Every key this module declares.

        Used where the assertion is about tenancy or a domain rule: a denial that
        could have come from a missing permission proves nothing about either.
        """
        from core.rbac.registry import registry

        self.allow(*(spec.key for spec in registry.for_module("timetable")))

    def make_slot(self, **overrides):
        """A draft slot on the base fixture's section, teacher, subject and room.

        Written through the factory inside `tenant_context` because the RLS
        policy's WITH CHECK clause rejects an insert whose tenant_id does not
        match the session GUC.
        """
        fields = {
            "tenant": self.tenant,
            "academic_session": self.session,
            "section": self.section,
            "period": self.period,
            "subject": self.subject,
            "staff": self.teacher,
            "room": self.room,
            "day_of_week": 0,
        }
        fields.update(overrides)
        with tenant_context(self.tenant.id):
            return TimetableSlotFactory(**fields)

    def sign_in_as_teacher(self, staff, *keys: str):
        """Swap the client onto the user behind ``staff``.

        A teacher's `/timetables/my` resolves through `staff.user_id`, so reading
        it means changing principal — granting the fixture's admin another key
        would still answer as a learner with no enrollments.
        """
        user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            staff.user_id = user.pk
            staff.save(update_fields=["user_id"])
        grant(user, *(keys or ("timetable.timetable.view",)))
        authenticate(self.client, user)
        return user

    def publish(self, slot) -> None:
        """Promote one slot in place, bypassing the publish action.

        Substitution tests need a *published* slot but are not testing publish,
        and going through `:publish` would drag the whole conflict run and its
        fixture requirements into a test about something else.
        """
        with tenant_context(self.tenant.id):
            TimetableSlot.objects.alive().filter(pk=slot.pk).update(
                status=SlotStatus.PUBLISHED, effective_from=self.session.start_date
            )
            return TimetableSlot.objects.alive().get(pk=slot.pk)
