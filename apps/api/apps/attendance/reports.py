"""§13's six reports, as pure query functions.

Separate from `services.py` for the reason `timetable.conflicts` is separate from
its own services: this is a self-contained query engine that two callers use —
the synchronous endpoint and the export job — and mixing it into the write path
would make the module's largest reads hard to find.

**No query inside a loop, anywhere in this file.** A register over a term is
exactly the shape `ENGINEERING_STANDARDS.md` §3's N+1 rule exists for, and every
function here is asserted with `assertNumQueries` so a later refactor that
reintroduces one fails rather than merely slows. Each returns plain rows —
dicts of scalars — so the serializer, the CSV writer and the PDF renderer all
read the same numbers.

Every function takes an already-scoped queryset rather than building its own.
§13's closing line is "all reports respect record scopes (a class teacher sees
assigned sections only)", and a report that queried the table directly would
quietly ignore that — the one place record scope is easiest to lose is the place
it matters most, because a report is read as authoritative.
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from django.db.models import Avg, Count, F, Q, QuerySet, Sum

from apps.attendance.models import (
    AttendanceStatus,
    LeaveRequest,
    StaffAttendance,
    StaffAttendanceStatus,
    StudentAttendance,
)

# The statuses that count as "in school" when computing an attendance rate. A
# half day counts as attendance for §13's percentage: the student was present for
# part of it, and reporting them wholly absent would understate every rate a
# school publishes. `excused` counts too — §5.1 makes it a sanctioned absence,
# which is the distinction from plain `absent`.
PRESENT_STATUSES = frozenset(
    {AttendanceStatus.PRESENT, AttendanceStatus.LATE, AttendanceStatus.HALF_DAY}
)
# `on_leave` and `excused` are neither present nor counted against a student:
# §13's defaulter report is about unexplained absence, and counting approved
# leave against a child would make a medical absence look like truancy.
EXCLUDED_FROM_RATE = frozenset({AttendanceStatus.ON_LEAVE, AttendanceStatus.EXCUSED})

DEFAULT_DEFAULTER_THRESHOLD = Decimal("75.0")


def _as_dicts(rows) -> list[dict]:
    """`.values()` yields TypedDict rows; every caller here wants plain dicts.

    Converted at the boundary rather than by loosening each return type: the CSV
    writer mutates its rows and the serializer indexes them by string, and both
    are clearer against a `dict` than against a per-query TypedDict.
    """
    return [dict(row) for row in rows]


def daily_register(queryset: QuerySet[StudentAttendance], *, on_date: datetime.date) -> list[dict]:
    """§13's daily attendance register — one section's day, student by student."""
    rows = (
        queryset.filter(attendance_date=on_date)
        .select_related("student", "section")
        .order_by("section__name", "student__first_name", "student__last_name")
        .values(
            "id",
            "status",
            "check_in_time",
            "late_minutes",
            "remarks",
            student_id=F("student__id"),
            first_name=F("student__first_name"),
            last_name=F("student__last_name"),
            admission_number=F("student__admission_number"),
            section_name=F("section__name"),
        )
    )
    return [dict(row) for row in rows]


def student_summary(
    queryset: QuerySet[StudentAttendance],
    *,
    start_date: datetime.date,
    end_date: datetime.date,
) -> list[dict]:
    """§13's per-student attendance percentage over a range.

    One grouped query, not one per student. The percentage is computed in Python
    from two counted columns rather than in SQL, because the "counted days"
    denominator excludes approved leave — expressible as a filtered `Count` but
    far harder to read, and this runs once per report rather than once per row.
    """
    grouped = (
        queryset.filter(attendance_date__gte=start_date, attendance_date__lte=end_date)
        .values(
            student_id=F("student__id"),
            first_name=F("student__first_name"),
            last_name=F("student__last_name"),
            admission_number=F("student__admission_number"),
        )
        .annotate(
            present_days=Count("id", filter=Q(status__in=PRESENT_STATUSES)),
            counted_days=Count("id", filter=~Q(status__in=EXCLUDED_FROM_RATE)),
            absent_days=Count("id", filter=Q(status=AttendanceStatus.ABSENT)),
            late_days=Count("id", filter=Q(status=AttendanceStatus.LATE)),
            leave_days=Count("id", filter=Q(status=AttendanceStatus.ON_LEAVE)),
        )
        .order_by("last_name", "first_name")
    )

    return [
        {**row, "attendance_rate": _rate(row["present_days"], row["counted_days"])}
        for row in grouped
    ]


def defaulters(
    queryset: QuerySet[StudentAttendance],
    *,
    start_date: datetime.date,
    end_date: datetime.date,
    threshold: Decimal | None = None,
) -> list[dict]:
    """§13's defaulter / chronic-absence report — students below a threshold.

    Filtered in Python off `student_summary`'s rows rather than re-queried: the
    grouping is identical and the set is one school's students, so a second
    database pass would buy nothing and could disagree with the summary a
    principal is reading beside it.

    A student with no counted days is **excluded**, not reported at 0%: they were
    never expected — a mid-year admission, or a range that is all holidays — and
    listing them as a defaulter would be a false accusation.
    """
    limit = DEFAULT_DEFAULTER_THRESHOLD if threshold is None else threshold
    return [
        row
        for row in student_summary(queryset, start_date=start_date, end_date=end_date)
        if row["counted_days"] > 0 and row["attendance_rate"] < limit
    ]


def student_late_arrivals(
    queryset: QuerySet[StudentAttendance],
    *,
    start_date: datetime.date,
    end_date: datetime.date,
) -> list[dict]:
    """§13's late-arrival report, student half — count and total minutes."""
    return _as_dicts(
        queryset.filter(
            attendance_date__gte=start_date,
            attendance_date__lte=end_date,
            status=AttendanceStatus.LATE,
        )
        .values(
            student_id=F("student__id"),
            first_name=F("student__first_name"),
            last_name=F("student__last_name"),
            admission_number=F("student__admission_number"),
        )
        .annotate(
            late_count=Count("id"),
            total_late_minutes=Sum("late_minutes"),
            average_late_minutes=Avg("late_minutes"),
        )
        .order_by("-late_count")
    )


def staff_punctuality(
    queryset: QuerySet[StaffAttendance],
    *,
    start_date: datetime.date,
    end_date: datetime.date,
) -> list[dict]:
    """§13's staff attendance & punctuality report — the payroll export.

    `holiday` rows are excluded from every count: the school was shut, and
    counting a closure against a teacher's punctuality is the mistake that status
    exists to prevent.
    """
    return _as_dicts(
        queryset.filter(
            attendance_date__gte=start_date,
            attendance_date__lte=end_date,
        )
        .exclude(status=StaffAttendanceStatus.HOLIDAY)
        .values(
            staff_id=F("staff__id"),
            first_name=F("staff__first_name"),
            last_name=F("staff__last_name"),
            employee_number=F("staff__employee_number"),
        )
        .annotate(
            working_days=Count("id"),
            present_days=Count(
                "id",
                filter=Q(
                    status__in=[
                        StaffAttendanceStatus.PRESENT,
                        StaffAttendanceStatus.LATE,
                        StaffAttendanceStatus.HALF_DAY,
                    ]
                ),
            ),
            absent_days=Count("id", filter=Q(status=StaffAttendanceStatus.ABSENT)),
            leave_days=Count("id", filter=Q(status=StaffAttendanceStatus.ON_LEAVE)),
            late_count=Count("id", filter=Q(status=StaffAttendanceStatus.LATE)),
            total_late_minutes=Sum("late_minutes"),
            total_early_departure_minutes=Sum("early_departure_minutes"),
        )
        .order_by("last_name", "first_name")
    )


def leave_report(
    queryset: QuerySet[LeaveRequest],
    *,
    start_date: datetime.date,
    end_date: datetime.date,
) -> list[dict]:
    """§13's leave report — **student leave only**, as §13 itself says.

    "student leave here; staff leave in hr-leave". The queryset is already
    narrowed to student requests by the caller, and this does not widen it.

    Overlap, not containment: a request that starts before the range and ends
    inside it belongs in a report about that range. Filtering on `start_date`
    alone would drop exactly the long absences a leave report exists to surface.
    """
    return _as_dicts(
        queryset.filter(start_date__lte=end_date, end_date__gte=start_date)
        .values(
            "id",
            "status",
            "start_date",
            "end_date",
            "days_count",
            "day_part",
            student_id=F("student__id"),
            first_name=F("student__first_name"),
            last_name=F("student__last_name"),
            leave_type_name=F("leave_type__name"),
        )
        .order_by("-start_date")
    )


def _rate(present_days: int, counted_days: int) -> Decimal:
    """Attendance percentage to one decimal place; 0 when nothing was counted."""
    if not counted_days:
        return Decimal("0.0")
    return (Decimal(present_days) * 100 / Decimal(counted_days)).quantize(Decimal("0.1"))
