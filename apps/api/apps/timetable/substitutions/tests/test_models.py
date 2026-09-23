"""Database-level guarantees for `teacher_substitutions`.

These assert the constraints rather than the services, because a constraint is
what still holds when two proposals arrive in the same second — and when the
attendance-driven substitution feed or a future importer writes the row without
going through `services` at all. `_assert_substitute_is_free` and
`_assert_room_is_free` are unlocked `.exists()` calls: they make the refusal
friendly and name the field, they do not make it safe.

The other half of each rule — the substitute's *own* published class in that
period, and a published slot already occupying the room — spans two tables and
cannot be an index, so it lives only in the service. `test_substitutions.py`
covers it.
"""

from __future__ import annotations

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.timetable.models import SubstitutionStatus, TeacherSubstitution
from apps.timetable.tests.base import TimetableAPITestCase
from apps.timetable.tests.factories import (
    MONDAY,
    StaffFactory,
    TeacherSubstitutionFactory,
)
from core.tenancy.context import tenant_context


class SubstitutionOccupancyConstraintTests(TimetableAPITestCase):
    """Fixture-only; these write rows directly and never make a request.

    Both published slots carry no teacher and no room of their own. That keeps
    them out of `slots_teacher_not_double_booked` and `slots_room_not_double_booked`
    — two cells at the same (weekday, period) is exactly the shape needed here,
    and the base grid's own constraints would otherwise refuse the fixture before
    the substitution constraints were reached.
    """

    def setUp(self) -> None:
        super().setUp()
        self.first = self.publish(self.make_slot(staff=None, room=None))
        self.second = self.publish(
            self.make_slot(section=self.other_section, staff=None, room=None)
        )
        with tenant_context(self.tenant.id):
            self.cover = StaffFactory(tenant=self.tenant, campus=self.campus)
            self.other_cover = StaffFactory(tenant=self.tenant, campus=self.campus)

    def substitute(self, slot, **overrides):
        fields = {
            "tenant": self.tenant,
            "timetable_slot": slot,
            "date": MONDAY,
            "absent_staff": self.teacher,
            "substitute_staff": self.cover,
        }
        fields.update(overrides)
        return TeacherSubstitutionFactory(**fields)

    def test_a_substitute_cannot_cover_two_cells_in_one_period(self) -> None:
        with tenant_context(self.tenant.id):
            self.substitute(self.first)
            with self.assertRaises(IntegrityError), transaction.atomic():
                self.substitute(self.second)

    def test_a_declined_cover_does_not_hold_the_substitute(self) -> None:
        """Only `proposed` and `confirmed` occupy the period — a teacher turned
        down for one class must stay assignable to another."""
        with tenant_context(self.tenant.id):
            self.substitute(self.first, status=SubstitutionStatus.DECLINED)
            self.substitute(self.second)

    def test_the_same_substitute_may_take_a_different_period(self) -> None:
        """Busy means busy in that period, not busy that day — which is the
        whole reason `period` is on the row and not only on the slot."""
        elsewhere = self.publish(
            self.make_slot(
                section=self.other_section, period=self.periods[1], staff=None, room=None
            )
        )
        with tenant_context(self.tenant.id):
            self.substitute(self.first)
            self.substitute(elsewhere)

    def test_a_room_cannot_be_moved_into_twice_in_one_period(self) -> None:
        with tenant_context(self.tenant.id):
            self.substitute(self.first, room=self.room)
            with self.assertRaises(IntegrityError), transaction.atomic():
                self.substitute(self.second, substitute_staff=self.other_cover, room=self.room)

    def test_substitutions_that_move_no_room_never_collide(self) -> None:
        """A null room means "keep the slot's own", which is not a booking. The
        index is partial on `room_id IS NOT NULL` so those rows are not in it."""
        with tenant_context(self.tenant.id):
            self.substitute(self.first)
            self.substitute(self.second, substitute_staff=self.other_cover)

    def test_a_soft_deleted_cover_releases_both(self) -> None:
        """Every other unique index in this module excludes soft-deleted rows;
        these two must agree, or a deleted proposal would keep holding a teacher
        and a room that the service already considers free."""
        with tenant_context(self.tenant.id):
            first = self.substitute(self.first, room=self.room)
            TeacherSubstitution.objects.filter(pk=first.pk).update(deleted_at=timezone.now())
            self.substitute(self.second, room=self.room)
