"""The school calendar: working days, holidays and the school-day window.

`attendance` §11 refuses to mark on a holiday or a non-working day, and computes
`late_minutes` against the day window. Neither existed anywhere in the backend
before this module; `school-organization.md` §5.8 and §16 assign both here, so
this is where they live rather than private to `attendance` — `examinations`
(scheduling around holidays) and `hr-leave` (`days_count` net of holidays) need
the same answers, and `timetable.services._slot_weekday` already carries a note
saying it is only correct while a tenant's week starts on Monday.

Backed by `tenant_settings.academic` JSONB, not a table: `entities/tenancy.md`
lists no `holiday_calendar` entity, the shape is tenant-configurable, and a
column per school that wants one more field is a migration per school.

Every default here is a *recommendation* made concrete. A tenant that has
configured nothing still gets Monday-Friday and an 08:00-14:00 day, because
attendance must be usable before anyone opens the settings screen — and a
platform that assumes no country (school-organization.md §11) still has to
assume *something* to boot. Every reader is total: a malformed entry is skipped
rather than raised on, because a typo in one holiday must not take down the
whole register.
"""

from __future__ import annotations

import datetime
import uuid
from collections.abc import Iterable
from dataclasses import dataclass

from core.tenancy.models import TenantSettings

# 0 = Monday, matching `datetime.date.weekday()` and `TimetableSlot.day_of_week`.
DEFAULT_WORKING_DAYS: tuple[int, ...] = (0, 1, 2, 3, 4)


@dataclass(frozen=True)
class DayWindow:
    """The school day a late arrival or early departure is measured against."""

    start: datetime.time
    end: datetime.time
    grace_minutes: int


DEFAULT_DAY_WINDOW = DayWindow(
    start=datetime.time(8, 0), end=datetime.time(14, 0), grace_minutes=10
)


def _academic() -> dict:
    """The current tenant's academic configuration, or an empty dict.

    Read through the tenant-scoped default manager, so this is only ever the
    bound tenant's row — there is deliberately no `tenant_id` argument.
    """
    row = TenantSettings.objects.first()
    if row is None or not isinstance(row.academic, dict):
        return {}
    return row.academic


def _parse_time(value: object, fallback: datetime.time) -> datetime.time:
    if not isinstance(value, str):
        return fallback
    try:
        return datetime.time.fromisoformat(value)
    except ValueError:
        return fallback


def _parse_date(value: object) -> datetime.date | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.date.fromisoformat(value)
    except ValueError:
        return None


def _working_days_from(academic: dict) -> frozenset[int]:
    """`working_days` over an already-loaded configuration.

    Split out so `working_day_map` can answer many days from one read — see
    that function's docstring. `working_days` stays the public single-answer
    form and delegates here, so there is one implementation of the rule.
    """
    configured = academic.get("working_days")
    if not isinstance(configured, list):
        return frozenset(DEFAULT_WORKING_DAYS)
    days = frozenset(day for day in configured if isinstance(day, int) and 0 <= day <= 6)
    # An empty or entirely malformed list would close the school permanently,
    # which is never what a caller meant — fall back rather than lock everyone out.
    return days or frozenset(DEFAULT_WORKING_DAYS)


def _holiday_name_from(
    academic: dict, day: datetime.date, *, campus_id: uuid.UUID | None
) -> str | None:
    """`holiday_name` over an already-loaded configuration."""
    campus_ref = str(campus_id) if campus_id is not None else None
    for entry in academic.get("holidays") or []:
        if not isinstance(entry, dict):
            continue
        scope = entry.get("campus_id")
        if scope is not None and scope != campus_ref:
            continue
        start = _parse_date(entry.get("start_date"))
        if start is None:
            continue
        end = _parse_date(entry.get("end_date")) or start
        if start <= day <= end:
            name = entry.get("name")
            return name if isinstance(name, str) and name else "Holiday"
    return None


def working_day_map(
    days: Iterable[tuple[datetime.date, uuid.UUID | None]],
) -> dict[tuple[datetime.date, uuid.UUID | None], tuple[bool, str | None]]:
    """Answer working-day and holiday for many (day, campus) pairs in **one** read.

    Every other function here reads `tenant_settings.academic` on each call,
    which is correct for the single-answer question `attendance` asks once per
    request and wrong for a caller asking about a whole exam week: `examinations`
    schedules a term of sittings and `is_working_day` alone costs two queries
    each, which CI caught as an N+1 inside a conflict detector that is
    documented as query-free.

    So this reads the configuration once and evaluates every pair against it.
    The rules are not restated — both branches delegate to the same private
    helpers `working_days` and `holiday_name` use — so a change to the
    working-week or holiday reading cannot apply to one caller and not the
    other.

    Returns `{(day, campus_id): (is_working_day, holiday_name)}`.
    """
    academic = _academic()
    week = _working_days_from(academic)
    answers: dict[tuple[datetime.date, uuid.UUID | None], tuple[bool, str | None]] = {}
    for day, campus_id in days:
        key = (day, campus_id)
        if key in answers:
            continue
        holiday = _holiday_name_from(academic, day, campus_id=campus_id)
        answers[key] = (day.weekday() in week and holiday is None, holiday)
    return answers


def working_days(*, campus_id: uuid.UUID | None = None) -> frozenset[int]:
    """Weekday numbers (0=Monday) the school operates on.

    `campus_id` is accepted for symmetry with the rest of this module and for
    the per-campus override §5.8 anticipates; the working week is tenant-wide
    today, and taking the argument now means no caller changes when it stops
    being.
    """
    return _working_days_from(_academic())


def holiday_name(day: datetime.date, *, campus_id: uuid.UUID | None = None) -> str | None:
    """The name of the holiday covering `day`, or None.

    An entry with no `campus_id` applies to every campus; one naming a campus
    applies only there and *adds to* the tenant-wide list rather than replacing
    it — the same reading `Period.campus` and `departments.campus_id` already use
    for a nullable campus reference.
    """
    return _holiday_name_from(_academic(), day, campus_id=campus_id)


def is_working_day(day: datetime.date, *, campus_id: uuid.UUID | None = None) -> bool:
    """False on a weekend or a holiday. `attendance` §11's marking gate."""
    if day.weekday() not in working_days(campus_id=campus_id):
        return False
    return holiday_name(day, campus_id=campus_id) is None


def day_window(*, campus_id: uuid.UUID | None = None) -> DayWindow:
    """The configured school day, falling back field by field.

    Field by field rather than all-or-nothing: a tenant that sets only
    `grace_minutes` should keep the default start and end, not silently lose
    both.
    """
    configured = _academic().get("day_window")
    if not isinstance(configured, dict):
        return DEFAULT_DAY_WINDOW

    grace = configured.get("grace_minutes")
    return DayWindow(
        start=_parse_time(configured.get("start"), DEFAULT_DAY_WINDOW.start),
        end=_parse_time(configured.get("end"), DEFAULT_DAY_WINDOW.end),
        grace_minutes=(
            grace
            if isinstance(grace, int) and not isinstance(grace, bool) and grace >= 0
            else DEFAULT_DAY_WINDOW.grace_minutes
        ),
    )


def _minutes_between(earlier: datetime.time, later: datetime.time) -> int:
    """Whole minutes from `earlier` to `later` on the same calendar day.

    Both are wall-clock times in the tenant's own timezone, never UTC instants:
    a school day starts at 08:00 locally whatever the offset, so combining them
    with a fixed date is the correct arithmetic rather than a shortcut.
    """
    delta = datetime.datetime.combine(datetime.date.min, later) - datetime.datetime.combine(
        datetime.date.min, earlier
    )
    return delta // datetime.timedelta(minutes=1)


def late_minutes(check_in: datetime.time, *, campus_id: uuid.UUID | None = None) -> int:
    """Minutes late, measured from the day's start — 0 inside the grace period.

    Measured from `start`, not from the end of the grace window: a student 25
    minutes late is 25 minutes late. Grace decides *whether* lateness counts, not
    how much of it does, or every punctuality report (§13) understates each entry
    by exactly the grace window.
    """
    window = day_window(campus_id=campus_id)
    minutes = _minutes_between(window.start, check_in)
    if minutes <= window.grace_minutes:
        return 0
    return minutes


def early_departure_minutes(check_out: datetime.time, *, campus_id: uuid.UUID | None = None) -> int:
    """Minutes left before the day's end; 0 for a check-out at or after it."""
    window = day_window(campus_id=campus_id)
    return max(_minutes_between(check_out, window.end), 0)
