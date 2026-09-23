"""Business rules for `periods` — the bell schedule (§5.1).

`assert_period_does_not_overlap` is exclusive to this resource: its only caller
is `PeriodSerializer.validate`.
"""

from __future__ import annotations

import uuid

from django.db.models import Q

from apps.timetable.models import Period
from core.api.exceptions import DomainRuleViolation

# ---------------------------------------------------------------------------
# Periods
# ---------------------------------------------------------------------------


def assert_period_does_not_overlap(
    *, campus_id: uuid.UUID | None, start_time, end_time, exclude_pk=None
) -> None:
    """§11: periods must not overlap within a day template.

    Compared against both the campus's own periods and the tenant-wide ones
    (`campus_id IS NULL`), because a tenant-wide period applies to this campus
    too — checking only the campus's own rows would let a campus period sit
    inside the tenant's lunch break.
    """
    siblings = Period.objects.alive().filter(Q(campus_id=campus_id) | Q(campus_id__isnull=True))
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
