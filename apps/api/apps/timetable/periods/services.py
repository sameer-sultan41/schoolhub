"""Business rules for `periods` — the bell schedule (§5.1).

`assert_period_does_not_overlap` is exclusive to this resource: its only caller
is `PeriodSerializer.validate`. `assert_period_not_in_use` guards the delete.
"""

from __future__ import annotations

import uuid

from django.db.models import Q
from django.utils import timezone

from apps.timetable.models import (
    OPEN_SUBSTITUTION_STATUSES,
    Period,
    TeacherSubstitution,
    TimetableSlot,
)
from core.api.exceptions import DomainRuleViolation

# ---------------------------------------------------------------------------
# Periods
# ---------------------------------------------------------------------------


def assert_period_does_not_overlap(
    *, campus_id: uuid.UUID | None, start_time, end_time, exclude_pk=None
) -> None:
    """§11: periods must not overlap within a day template.

    A campus period is compared with its campus's own periods and the tenant-wide ones
    (`campus_id IS NULL`), because a tenant-wide period applies to that campus too.
    A tenant-wide period applies to every campus, so it is compared with all of them;
    filtering on `campus_id=None` would only ever find other tenant-wide rows.
    """
    siblings = Period.objects.alive()
    if campus_id is not None:
        siblings = siblings.filter(Q(campus_id=campus_id) | Q(campus_id__isnull=True))
    if exclude_pk is not None:
        siblings = siblings.exclude(pk=exclude_pk)

    clash = siblings.filter(start_time__lt=end_time, end_time__gt=start_time).first()
    if clash is not None:
        raise DomainRuleViolation(
            {
                "start_time": (
                    f"This overlaps '{clash.name}' ({clash.start_time}-{clash.end_time}). "
                    "Periods in one day template may not overlap."
                )
            }
        )


def assert_period_not_in_use(period: Period) -> None:
    """A period a current grid cell or upcoming cover still runs on cannot be removed.

    Removal is a soft delete, which `on_delete=PROTECT` never sees, so without this
    the row would leave `Period.objects.alive()` while live cells still point at it:
    the week grid, drawn from the alive periods, would lose those cells while
    `/timetables/my` kept serving them. Superseded cells (`effective_to` set) are
    history and do not count.
    """
    in_grid = TimetableSlot.objects.alive().filter(period=period, effective_to__isnull=True)
    in_cover = TeacherSubstitution.objects.alive().filter(
        period=period, status__in=OPEN_SUBSTITUTION_STATUSES, date__gte=timezone.localdate()
    )
    if in_grid.exists() or in_cover.exists():
        raise DomainRuleViolation(
            "This period is still on a timetable. Remove it from every section's grid, "
            "and from any upcoming cover, before removing it."
        )
