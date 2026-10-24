"""`services.teacher_slots_for` — the teacher projection `/timetables/my` and attendance share.

`/timetables/my`'s own behaviour after the hoist is asserted unchanged by
`test_endpoints.MyTimetableTests`; these cover what the hoist added: more than one
staff id at once, and an empty set.
"""

from __future__ import annotations

from apps.timetable.models import SubstitutionStatus
from apps.timetable.slots import services
from apps.timetable.tests.base import TimetableAPITestCase
from apps.timetable.tests.factories import (
    MONDAY,
    StaffFactory,
    TeacherAllocationFactory,
    TeacherSubstitutionFactory,
)
from core.tenancy.context import tenant_context


class TeacherSlotsForTests(TimetableAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.colleague = StaffFactory(tenant=self.tenant, campus=self.campus)
            TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=self.other_section,
                subject=self.subject,
                staff=self.colleague,
            )
        self.mine = self.publish(self.make_slot())
        # Another period, or the shared fixture room would be double-booked.
        self.theirs = self.publish(
            self.make_slot(section=self.other_section, staff=self.colleague, period=self.periods[1])
        )

    def slot_ids(self, staff_ids, on_date=None) -> set:
        with tenant_context(self.tenant.id):
            slots, _ = services.teacher_slots_for(
                staff_ids=staff_ids, session=self.session, on_date=on_date
            )
        return {slot.pk for slot in slots}

    def test_one_staff_id_gets_only_their_cells(self) -> None:
        self.assertEqual(self.slot_ids([self.teacher.pk]), {self.mine.pk})

    def test_several_staff_ids_get_every_cell_they_hold(self) -> None:
        self.assertEqual(
            self.slot_ids([self.teacher.pk, self.colleague.pk]), {self.mine.pk, self.theirs.pk}
        )

    def test_a_confirmed_cover_adds_the_covered_cell_and_its_override(self) -> None:
        with tenant_context(self.tenant.id):
            TeacherSubstitutionFactory(
                tenant=self.tenant,
                timetable_slot=self.theirs,
                date=MONDAY,
                absent_staff=self.colleague,
                substitute_staff=self.teacher,
                status=SubstitutionStatus.CONFIRMED,
            )
            slots, overrides = services.teacher_slots_for(
                staff_ids=[self.teacher.pk], session=self.session, on_date=MONDAY
            )

        self.assertEqual({slot.pk for slot in slots}, {self.mine.pk, self.theirs.pk})
        self.assertEqual(overrides[self.theirs.pk].substitute_staff_id, self.teacher.pk)

    def test_no_staff_ids_is_an_empty_projection(self) -> None:
        with tenant_context(self.tenant.id):
            self.assertEqual(
                services.teacher_slots_for(staff_ids=[], session=self.session, on_date=MONDAY),
                ([], {}),
            )
