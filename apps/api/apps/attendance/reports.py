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

from django.core.exceptions import EmptyResultSet
from django.db import connections
from django.db.models import Count, F, Q, QuerySet, Sum
from psycopg import sql

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


def _capped(rows, limit: int | None):
    """Apply the caller's row cap as a queryset slice.

    A slice, not a Python truncation: the point of the cap is that the rows
    are never built, so it has to reach SQL as a LIMIT. `None` means
    unbounded, which is what the export job asks for.
    """
    return rows if limit is None else rows[:limit]


def _as_dicts(rows) -> list[dict]:
    """`.values()` yields TypedDict rows; every caller here wants plain dicts.

    Converted at the boundary rather than by loosening each return type: the CSV
    writer mutates its rows and the serializer indexes them by string, and both
    are clearer against a `dict` than against a per-query TypedDict.
    """
    return [dict(row) for row in rows]


# ---------------------------------------------------------------------------
# Derived days (ADR-0028), computed in SQL
# ---------------------------------------------------------------------------
#
# The reporting unit is the day in either mode. One grouped query turns a
# student's rows for a date into a day, and the per-student reports aggregate
# those days in the same statement, so Python receives one row per output row
# whatever the range. The scoped queryset supplies the rows (its record scope,
# filters and joins), and the derivation wraps its SQL as a CTE; every value is
# a bound parameter, and it runs on the request's own connection, so RLS holds.

# One scoped attendance row, aliased so the SQL below names columns, never tables.
_ROW_COLUMNS = {
    "row_id": F("id"),
    "row_student": F("student_id"),
    "row_date": F("attendance_date"),
    "row_period": F("period_id"),
    "row_start": F("period__start_time"),
    "row_sequence": F("period__sequence"),
    "row_status": F("status"),
    "row_late": F("late_minutes"),
    "row_check_in": F("check_in_time"),
    "row_remarks": F("remarks"),
    "row_first_name": F("student__first_name"),
    "row_last_name": F("student__last_name"),
    "row_admission": F("student__admission_number"),
    "row_section": F("section__name"),
}

_DAILY = "BOOL_OR(row_period IS NULL)"
_DAILY_ONLY = "FILTER (WHERE row_period IS NULL)"


def _earliest_period(column: str) -> str:
    """`column` of the date's earliest marked period."""
    return (
        f"(ARRAY_AGG({column} ORDER BY row_start, row_sequence) "
        "FILTER (WHERE row_period IS NOT NULL))[1]"
    )


# No daily row, no absent period, and the earliest marked period late.
_DERIVED_LATE = (
    f"(NOT BOOL_OR(row_status = %s) AND {_earliest_period('row_status')} = %s)",
    (AttendanceStatus.ABSENT.value, AttendanceStatus.LATE.value),
)

# The design's rules, in order: a daily row is the day; all periods absent is
# absent; any absent is a half day; the earliest marked period late is late; all
# excused is excused; anything else is present.
_DAY_STATUS = (
    f"""CASE
        WHEN {_DAILY} THEN MAX(row_status) {_DAILY_ONLY}
        WHEN BOOL_AND(row_status = %s) THEN %s
        WHEN BOOL_OR(row_status = %s) THEN %s
        WHEN {_DERIVED_LATE[0]} THEN %s
        WHEN BOOL_AND(row_status = %s) THEN %s
        ELSE %s
    END AS status""",
    (
        AttendanceStatus.ABSENT.value,
        AttendanceStatus.ABSENT.value,
        AttendanceStatus.ABSENT.value,
        AttendanceStatus.HALF_DAY.value,
        *_DERIVED_LATE[1],
        AttendanceStatus.LATE.value,
        AttendanceStatus.EXCUSED.value,
        AttendanceStatus.EXCUSED.value,
        AttendanceStatus.PRESENT.value,
    ),
)

# A daily row's own minutes, or the earliest period's when the day is derived late.
_DAY_LATE = (
    f"""CASE
        WHEN {_DAILY} THEN MAX(row_late) {_DAILY_ONLY}
        WHEN {_DERIVED_LATE[0]} THEN {_earliest_period("row_late")}
    END AS late_minutes""",
    _DERIVED_LATE[1],
)

# The daily register's columns: the daily row's own, or the derived day's.
_DAY_DETAIL = (
    f"""(ARRAY_AGG(row_id) {_DAILY_ONLY})[1] AS id,
    MAX(row_remarks) {_DAILY_ONLY} AS remarks,
    MIN(row_section) AS section_name,
    CASE
        WHEN {_DAILY} THEN MAX(row_check_in) {_DAILY_ONLY}
        WHEN {_DERIVED_LATE[0]} THEN {_earliest_period("row_check_in")}
    END AS check_in_time""",
    _DERIVED_LATE[1],
)


# The `days` CTE over `day_rows`, the scoped queryset's own compiled SQL. Composed
# with psycopg's `sql` module, never string formatting: every value is a bound
# `%s` parameter, and the only text composed in is Django's compiled query and
# this module's own fragments.
_DAYS_CTE = sql.SQL(
    """WITH day_rows AS ({rows}),
days AS (
    SELECT
        row_student AS student_id,
        row_date AS attendance_date,
        MIN(row_first_name) AS first_name,
        MIN(row_last_name) AS last_name,
        MIN(row_admission) AS admission_number,
        {derived}
    FROM day_rows
    GROUP BY row_student, row_date
)"""
)


def _days_cte(queryset: QuerySet[StudentAttendance], *, detail: bool = False):
    """`WITH day_rows AS (...), days AS (...)`: one row per (student, date), its day derived.

    Returns `(query, params)`, a `psycopg.sql.Composed` and its params in the
    order their placeholders appear. Compiled on the alias it runs on
    (``_over_days`` uses `queryset.db` too). Raises `EmptyResultSet` for a
    queryset that can match nothing.
    """
    rows = queryset.order_by().values(**_ROW_COLUMNS).query
    rows_sql, rows_params = rows.get_compiler(using=queryset.db).as_sql()
    selected: list[tuple[str, tuple[str, ...]]] = [_DAY_STATUS, _DAY_LATE]
    if detail:
        selected.append(_DAY_DETAIL)
    derived = sql.SQL(",\n        ").join(sql.SQL(fragment) for fragment, _ in selected)
    query = _DAYS_CTE.format(rows=sql.SQL(rows_sql), derived=derived)
    return query, [*rows_params, *(param for _, params in selected for param in params)]


def _over_days(
    queryset: QuerySet[StudentAttendance], tail: sql.Composable, params: list, *, detail=False
) -> list[dict]:
    """Run `tail` (more CTEs and the final `SELECT`) over the `days` CTE; one dict per row.

    The one place a derived report reaches the database. A queryset that can
    match nothing — an empty `__in`, or `scope_queryset`'s fail-closed `.none()`
    — does not compile to SQL at all (`EmptyResultSet`), so it is no rows and
    no query, as iterating the queryset would have been. Django's cursor hands
    the `Composed` query to psycopg, which renders it and binds the params.
    """
    try:
        cte, cte_params = _days_cte(queryset, detail=detail)
    except EmptyResultSet:
        return []
    with connections[queryset.db].cursor() as cursor:
        cursor.execute(cte + sql.SQL("\n") + tail, [*cte_params, *params])
        names = [column[0] for column in cursor.description or ()]
        return [dict(zip(names, row, strict=True)) for row in cursor.fetchall()]


def _in_range(queryset, *, start_date: datetime.date, end_date: datetime.date):
    return queryset.filter(attendance_date__gte=start_date, attendance_date__lte=end_date)


# Every capped tail ends in `LIMIT %s`; the export job's unbounded read binds
# `None`, and PostgreSQL reads `LIMIT NULL` as no limit.
_DERIVED_DAYS_TAIL = sql.SQL(
    """SELECT student_id, attendance_date, status, late_minutes
FROM days
ORDER BY student_id, attendance_date"""
)

_DAILY_REGISTER_TAIL = sql.SQL(
    """SELECT
    id, status, check_in_time, late_minutes, remarks, student_id,
    first_name, last_name, admission_number, section_name, NULL AS period_name
FROM days
ORDER BY section_name, first_name, last_name, student_id
LIMIT %s"""
)

# `..., rated AS (...)`: §13's per-student day counts and rate, over derived days.
# `attendance_rate` is the percentage of counted days present, to one decimal
# place (rounded half up), and 0.0 when nothing was counted; the denominator
# leaves out approved leave and excused days.
_RATED = sql.SQL(
    """,
summary AS (
    SELECT
        student_id,
        MIN(first_name) AS first_name,
        MIN(last_name) AS last_name,
        MIN(admission_number) AS admission_number,
        COUNT(*) FILTER (WHERE status = ANY(%s)) AS present_days,
        COUNT(*) FILTER (WHERE NOT status = ANY(%s)) AS counted_days,
        COUNT(*) FILTER (WHERE status = %s) AS absent_days,
        COUNT(*) FILTER (WHERE status = %s) AS late_days,
        COUNT(*) FILTER (WHERE status = %s) AS leave_days
    FROM days
    GROUP BY student_id
),
rated AS (
    SELECT
        *,
        COALESCE(ROUND(100.0 * present_days / NULLIF(counted_days, 0), 1), 0.0)
            AS attendance_rate
    FROM summary
)"""
)
_RATED_PARAMS = (
    sorted(status.value for status in PRESENT_STATUSES),
    sorted(status.value for status in EXCLUDED_FROM_RATE),
    AttendanceStatus.ABSENT.value,
    AttendanceStatus.LATE.value,
    AttendanceStatus.ON_LEAVE.value,
)

_SUMMARY_TAIL = _RATED + sql.SQL(
    """
SELECT * FROM rated
ORDER BY last_name, first_name, student_id
LIMIT %s"""
)

_DEFAULTERS_TAIL = _RATED + sql.SQL(
    """
SELECT * FROM rated
WHERE counted_days > 0 AND attendance_rate < %s
ORDER BY last_name, first_name, student_id
LIMIT %s"""
)

_LATE_ARRIVALS_TAIL = sql.SQL(
    """SELECT
    student_id,
    MIN(first_name) AS first_name,
    MIN(last_name) AS last_name,
    MIN(admission_number) AS admission_number,
    COUNT(*) AS late_count,
    SUM(late_minutes) AS total_late_minutes,
    AVG(late_minutes)::float8 AS average_late_minutes
FROM days
WHERE status = %s
GROUP BY student_id
ORDER BY late_count DESC, last_name, first_name, student_id
LIMIT %s"""
)


def derived_days(
    queryset: QuerySet[StudentAttendance],
    *,
    start_date: datetime.date,
    end_date: datetime.date,
) -> list[dict]:
    """One day per (student, date): `{student_id, attendance_date, status, late_minutes}`.

    The reporting unit is the day in either mode, so percentages, defaulters and
    report cards stay in days and history stays comparable across a switch. A
    daily row wins over any period rows the same date; imported and leave rows
    are daily rows, so they count as they are. One query.
    """
    in_range = _in_range(queryset, start_date=start_date, end_date=end_date)
    return _over_days(in_range, _DERIVED_DAYS_TAIL, [])


def daily_register(
    queryset: QuerySet[StudentAttendance],
    *,
    on_date: datetime.date,
    period_id: str | None = None,
    limit: int | None = None,
) -> list[dict]:
    """§13's daily attendance register — one section's day, student by student.

    One row per student: the daily row as marked, or the day derived from that
    date's period rows (`id`, `remarks` and `period_name` null, `check_in_time`
    the earliest period's when the day is late). With `period_id`, one period's
    own rows instead. One query either way.
    """
    if period_id is not None:
        rows = (
            queryset.filter(attendance_date=on_date, period_id=period_id)
            .order_by("section__name", "student__first_name", "student__last_name")
            .values(
                "id",
                "status",
                "check_in_time",
                "late_minutes",
                "remarks",
                "student_id",
                first_name=F("student__first_name"),
                last_name=F("student__last_name"),
                admission_number=F("student__admission_number"),
                section_name=F("section__name"),
                period_name=F("period__name"),
            )
        )
        return _as_dicts(_capped(rows, limit))

    on_the_day = queryset.filter(attendance_date=on_date)
    return _over_days(on_the_day, _DAILY_REGISTER_TAIL, [limit], detail=True)


def student_summary(
    queryset: QuerySet[StudentAttendance],
    *,
    start_date: datetime.date,
    end_date: datetime.date,
    limit: int | None = None,
) -> list[dict]:
    """§13's per-student attendance percentage over a range, counted in days.

    Over ``derived_days``, in one query: in period mode a date of period rows is
    one day, not one row per period. `limit` reaches SQL as a LIMIT.
    """
    in_range = _in_range(queryset, start_date=start_date, end_date=end_date)
    return _over_days(in_range, _SUMMARY_TAIL, [*_RATED_PARAMS, limit])


def defaulters(
    queryset: QuerySet[StudentAttendance],
    *,
    start_date: datetime.date,
    end_date: datetime.date,
    threshold: Decimal | None = None,
    limit: int | None = None,
) -> list[dict]:
    """§13's defaulter / chronic-absence report — students below a threshold.

    The same rows as ``student_summary``, filtered in the same statement, so the
    two cannot disagree and `limit` caps the defaulters themselves — the first N
    defaulters, not the first N students.

    A student with no counted days is **excluded**, not reported at 0%: they were
    never expected — a mid-year admission, or a range that is all holidays — and
    listing them as a defaulter would be a false accusation.
    """
    cutoff = DEFAULT_DEFAULTER_THRESHOLD if threshold is None else threshold
    in_range = _in_range(queryset, start_date=start_date, end_date=end_date)
    return _over_days(in_range, _DEFAULTERS_TAIL, [*_RATED_PARAMS, cutoff, limit])


def student_late_arrivals(
    queryset: QuerySet[StudentAttendance],
    *,
    start_date: datetime.date,
    end_date: datetime.date,
    limit: int | None = None,
) -> list[dict]:
    """§13's late-arrival report, student half — late days and their minutes.

    Over ``derived_days``: a period-mode day is late when its earliest marked
    period was, with that period's minutes. One query; most late days first.
    """
    in_range = _in_range(queryset, start_date=start_date, end_date=end_date)
    return _over_days(in_range, _LATE_ARRIVALS_TAIL, [AttendanceStatus.LATE.value, limit])


def staff_punctuality(
    queryset: QuerySet[StaffAttendance],
    *,
    start_date: datetime.date,
    end_date: datetime.date,
    limit: int | None = None,
) -> list[dict]:
    """§13's staff attendance & punctuality report — the payroll export.

    `holiday` rows are excluded from every count: the school was shut, and
    counting a closure against a teacher's punctuality is the mistake that status
    exists to prevent.
    """
    rows = (
        queryset.filter(
            attendance_date__gte=start_date,
            attendance_date__lte=end_date,
        )
        .exclude(status=StaffAttendanceStatus.HOLIDAY)
        .values(
            "staff_id",
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
    return _as_dicts(_capped(rows, limit))


def leave_report(
    queryset: QuerySet[LeaveRequest],
    *,
    start_date: datetime.date,
    end_date: datetime.date,
    limit: int | None = None,
) -> list[dict]:
    """§13's leave report — **student leave only**, as §13 itself says.

    "student leave here; staff leave in hr-leave". The queryset is already
    narrowed to student requests by the caller, and this does not widen it.

    Overlap, not containment: a request that starts before the range and ends
    inside it belongs in a report about that range. Filtering on `start_date`
    alone would drop exactly the long absences a leave report exists to surface.
    """
    rows = (
        queryset.filter(start_date__lte=end_date, end_date__gte=start_date)
        .values(
            "id",
            "status",
            "start_date",
            "end_date",
            "days_count",
            "day_part",
            "student_id",
            first_name=F("student__first_name"),
            last_name=F("student__last_name"),
            leave_type_name=F("leave_type__name"),
        )
        .order_by("-start_date")
    )
    return _as_dicts(_capped(rows, limit))
