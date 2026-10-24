"""Business rules for `rooms` (§5.4): the guard on removing one."""

from __future__ import annotations

from django.utils import timezone

from apps.timetable.models import (
    OPEN_SUBSTITUTION_STATUSES,
    Room,
    TeacherSubstitution,
    TimetableSlot,
)
from core.api.exceptions import DomainRuleViolation


def assert_room_not_in_use(room: Room) -> None:
    """A room a current grid cell or upcoming cover still names cannot be removed.

    The same reasoning as `periods.services.assert_period_not_in_use`: removal is a
    soft delete, which `on_delete=PROTECT` never sees. Taking the room out of service
    (`is_active`) is the way to retire one that is still timetabled.
    """
    in_grid = TimetableSlot.objects.alive().filter(room=room, effective_to__isnull=True)
    in_cover = TeacherSubstitution.objects.alive().filter(
        room=room, status__in=OPEN_SUBSTITUTION_STATUSES, date__gte=timezone.localdate()
    )
    if in_grid.exists() or in_cover.exists():
        raise DomainRuleViolation(
            "This room is still on a timetable. Take it out of service instead, or remove "
            "it from every grid cell and upcoming cover first."
        )
