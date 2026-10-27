"""Business rules for the attendance module.

Views stay thin: every rule that needs more than the request body lives here, so
the API, the historical-attendance importer §9 anticipates, and the leave module's
auto-marking all apply the same checks rather than three drifting copies.

The one rule worth reading before anything else is in
``bulk_mark_student_attendance``: marking is an **upsert**, not an insert,
because §6 requires it to be idempotent per (student, date, period). That is not
a nicety — a teacher marks a register on a phone, on school Wi-Fi, and the
request is genuinely re-sent.
"""

from __future__ import annotations

import datetime
import logging
import uuid
from decimal import Decimal
from typing import TYPE_CHECKING, Literal, NamedTuple

from django.db import IntegrityError, transaction
from django.db.models import F
from django.db.models.functions import Length
from django.utils import timezone

from apps.attendance import uploads
from apps.attendance.models import (
    ApprovalDecision,
    AttendanceCorrection,
    AttendanceSource,
    AttendanceStatus,
    CorrectionStatus,
    CorrectionSubjectType,
    DayPart,
    LeaveApproval,
    LeaveRequest,
    LeaveStatus,
    LeaveType,
    RequesterType,
    StaffAttendance,
    StaffAttendanceSource,
    StaffAttendanceStatus,
    StudentAttendance,
)
from apps.school_organization import calendar
from apps.school_organization.models import AcademicSession
from apps.school_organization.services import assert_session_writable
from apps.student_management.models import EnrollmentStatus, Student, StudentEnrollment
from apps.student_management.services import assert_file_usable
from apps.timetable.slots.services import effective_slots_for
from core.api.exceptions import Conflict, DomainRuleViolation
from core.imports.tabular import parse_rows
from core.rbac.models import RecordScope
from core.rbac.permissions import user_scopes
from core.tenancy.features import is_feature_enabled
from core.tenancy.models import TenantSettings

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from apps.school_organization.models import Section
    from apps.staff_management.models import Staff
    from apps.timetable.models import Period, TimetableSlot

# §19: "lock window: end of marking day (recommendation; tenant-configurable
# 0-7 days)". Zero means "locks tonight", which is the recommended default.
DEFAULT_LOCK_WINDOW_DAYS = 0
MAX_LOCK_WINDOW_DAYS = 7

# §19's `attendance_mode`. Daily is the default and the fallback for anything else stored.
type AttendanceMode = Literal["daily", "period"]
ATTENDANCE_MODE_DAILY: AttendanceMode = "daily"
ATTENDANCE_MODE_PERIOD: AttendanceMode = "period"
ATTENDANCE_MODES: tuple[AttendanceMode, ...] = (ATTENDANCE_MODE_DAILY, ATTENDANCE_MODE_PERIOD)

# Period mode reads the timetable, so switching to it, and marking in it, need this module on.
TIMETABLE_FEATURE = "module.timetable"
TIMETABLE_REQUIRED = "Period attendance needs the timetable module; turn it on first."

# The `tenant_settings.academic` keys this module reads and `/attendance-settings` writes.
ATTENDANCE_MODE_SETTING = "attendance_mode"
LOCK_WINDOW_SETTING = "attendance_lock_window_days"
LEAVE_APPROVAL_SETTING = "student_leave_approval"
ESCALATION_THRESHOLD_SETTING = "escalation_threshold_days"

# Why the register for a date renders read-only (`meta.unmarkable_reason`).
UNMARKABLE_FUTURE = "future"
UNMARKABLE_HOLIDAY = "holiday"
UNMARKABLE_NON_WORKING_DAY = "non_working_day"
UNMARKABLE_SESSION_CLOSED = "session_closed"

# The 422 on `section_id` for a marker who holds `assigned` scope but not this register.
NOT_ASSIGNED_TO_SECTION = "You are not assigned to mark this section."

# The `meta.rows` issue for a student a register may not mark because of approved leave.
ON_APPROVED_LEAVE = (
    "This student has approved leave on this date; cancel the leave request before marking them."
)

# The statuses that make a guardian alert appropriate (§12's first two rows).
ALERT_STATUSES = frozenset({AttendanceStatus.ABSENT, AttendanceStatus.LATE})

# Written by the leave module on approval, never by a teacher at the register:
# a status that means "there is an approved leave request" must not be settable
# without one, or the `leave_request_id` back-link would be a lie.
SYSTEM_ONLY_STATUSES = frozenset({AttendanceStatus.ON_LEAVE})


# ---------------------------------------------------------------------------
# The calendar and the lock window
# ---------------------------------------------------------------------------


def _academic_settings() -> dict:
    """The bound tenant's `tenant_settings.academic`, or an empty dict."""
    row = TenantSettings.objects.first()
    return row.academic if row is not None and isinstance(row.academic, dict) else {}


def lock_window_days() -> int:
    """How long a marked row stays editable in place, in days.

    Read from ``tenant_settings.academic.attendance_lock_window_days`` and
    clamped to §19's stated 0-7 range rather than trusted: this decides whether a
    register can still be edited, and a tenant that stores 3650 has effectively
    turned the correction workflow off without anyone deciding to.
    """
    return lock_window_days_from(_academic_settings())


def lock_window_days_from(academic: dict) -> int:
    """``lock_window_days`` over an already-loaded `academic` dict."""
    configured = academic.get(LOCK_WINDOW_SETTING)
    if not isinstance(configured, int) or isinstance(configured, bool):
        return DEFAULT_LOCK_WINDOW_DAYS
    return max(0, min(configured, MAX_LOCK_WINDOW_DAYS))


def attendance_mode() -> AttendanceMode:
    """§19's `attendance_mode`: `daily` (the default) or `period`.

    Read from ``tenant_settings.academic.attendance_mode``; a missing or unknown
    value is `daily`, the same fall-back-rather-than-trust reading as
    ``lock_window_days``.
    """
    return attendance_mode_from(_academic_settings())


def attendance_mode_from(academic: dict) -> AttendanceMode:
    """``attendance_mode`` over an already-loaded `academic` dict."""
    if academic.get(ATTENDANCE_MODE_SETTING) == ATTENDANCE_MODE_PERIOD:
        return ATTENDANCE_MODE_PERIOD
    return ATTENDANCE_MODE_DAILY


def attendance_settings_from(academic: dict) -> dict:
    """The `/attendance-settings` shape: effective values, read the way they are enforced."""
    return {
        "attendance_mode": attendance_mode_from(academic),
        "lock_window_days": lock_window_days_from(academic),
        "leave_escalation_threshold_days": escalation_threshold_days_from(academic),
    }


def read_attendance_settings(*, tenant_id: uuid.UUID) -> dict:
    """The tenant's attendance settings, defaults applied. One query."""
    row = TenantSettings.objects.filter(tenant_id=tenant_id).first()
    academic = row.academic if row is not None and isinstance(row.academic, dict) else {}
    return attendance_settings_from(academic)


def assert_mode_switch_allowed(*, changes: dict, tenant_id: uuid.UUID) -> None:
    """Period mode reads the timetable, so it is refused while `module.timetable` is off."""
    if changes.get("attendance_mode") != ATTENDANCE_MODE_PERIOD:
        return
    if not is_feature_enabled(TIMETABLE_FEATURE, tenant_id=tenant_id):
        raise DomainRuleViolation({"attendance_mode": TIMETABLE_REQUIRED})


def update_attendance_settings(
    *, tenant_id: uuid.UUID, changes: dict, actor_id: uuid.UUID
) -> tuple[TenantSettings, dict, dict]:
    """Merge `changes` into the tenant's `academic` under a row lock: `(row, before, after)`.

    Fetch-or-create, as `school_organization.tenant_settings.get_settings_row`
    does (provisioning may not have made the row yet), but locked, so the row
    is read once. Only the changed keys are written, so sibling keys survive,
    and the nested `student_leave_approval` dict is merged rather than
    replaced. Two queries when the row exists (the locked read and the update);
    the caller holds the transaction.
    """
    locked, _ = TenantSettings.objects.select_for_update().get_or_create(
        tenant_id=tenant_id, defaults={"created_by": actor_id, "updated_by": actor_id}
    )
    before = dict(locked.academic) if isinstance(locked.academic, dict) else {}
    after = dict(before)
    if "attendance_mode" in changes:
        after[ATTENDANCE_MODE_SETTING] = changes["attendance_mode"]
    if "lock_window_days" in changes:
        after[LOCK_WINDOW_SETTING] = changes["lock_window_days"]
    if "leave_escalation_threshold_days" in changes:
        after[LEAVE_APPROVAL_SETTING] = {
            **leave_approval_config(before),
            ESCALATION_THRESHOLD_SETTING: changes["leave_escalation_threshold_days"],
        }
    locked.academic = after
    locked.updated_by = actor_id
    locked.save(update_fields=["academic", "updated_by", "updated_at"])
    return locked, before, after


def session_for_date(on_date: datetime.date) -> AcademicSession | None:
    """The session whose dates contain `on_date` (the current one first), else the current one.

    A date inside last session's lock window belongs to last session's roster
    and timetable, not the current one's. The register views and the period
    marker check both resolve it here so they agree.
    """
    containing = (
        AcademicSession.objects.alive()
        .filter(start_date__lte=on_date, end_date__gte=on_date)
        .order_by("-is_current", "-start_date")
        .first()
    )
    if containing is not None:
        return containing
    return AcademicSession.objects.alive().filter(is_current=True).first()


# ---------------------------------------------------------------------------
# Period mode: the timetable that day
# ---------------------------------------------------------------------------


class LessonCell(NamedTuple):
    """A section's lesson in one period on one date, and who teaches it that day."""

    slot: TimetableSlot
    teacher_id: uuid.UUID | None


def lesson_cells(
    slots: list[TimetableSlot], overrides: dict, *, on_date: datetime.date
) -> dict[tuple[uuid.UUID, uuid.UUID], LessonCell]:
    """``effective_slots_for``'s answer narrowed to `on_date`'s weekday, keyed (section, period).

    The teacher is the confirmed substitute where there is one: cover replaces
    the absent teacher for that date. Break periods are never a lesson.
    """
    weekday = on_date.weekday()
    cells: dict[tuple[uuid.UUID, uuid.UUID], LessonCell] = {}
    for slot in slots:
        if slot.day_of_week != weekday or slot.period.is_break:
            continue
        override = overrides.get(slot.pk)
        teacher_id = override.substitute_staff_id if override is not None else slot.staff_id
        cells[(slot.section_id, slot.period_id)] = LessonCell(slot, teacher_id)
    return cells


def effective_lessons(
    *, session: AcademicSession, section_ids: list[uuid.UUID], on_date: datetime.date
) -> dict[tuple[uuid.UUID, uuid.UUID], LessonCell]:
    """The lessons these sections had on `on_date`, version- and cover-aware.

    Through ``effective_slots_for``, never today's published grid: a republish
    end-dates the old cells, so a past date inside the lock window must be read
    against the version in force that day.
    """
    slots, overrides = effective_slots_for(
        session=session, section_ids=section_ids, on_date=on_date
    )
    return lesson_cells(slots, overrides, on_date=on_date)


def assert_period_fits_mode(*, period: Period | None) -> None:
    """One mode at a time (ADR-0028): a period only in period mode, and always in it."""
    mode = attendance_mode()
    if mode == ATTENDANCE_MODE_DAILY and period is not None:
        raise DomainRuleViolation(
            {"period_id": "This school takes attendance once a day; leave the period out."}
        )
    if mode == ATTENDANCE_MODE_PERIOD and period is None:
        raise DomainRuleViolation(
            {"period_id": "This school takes attendance per period; name the period."}
        )


def assert_session_contains(*, session: AcademicSession, on_date: datetime.date) -> None:
    """A register's rows and roster belong to its session, so the session must contain the date."""
    if not session.start_date <= on_date <= session.end_date:
        raise DomainRuleViolation(
            {"academic_session_id": f"{on_date} is outside the {session.name} session."}
        )


def assert_register_period(
    *,
    session: AcademicSession,
    section: Section,
    period: Period | None,
    on_date: datetime.date,
    lessons: dict[tuple[uuid.UUID, uuid.UUID], LessonCell] | None = None,
) -> None:
    """The register's period fits the mode, its session contains the date, and in period
    mode the period is a lesson that day.

    The session check runs in both modes: a daily register named against a stale
    session would otherwise write today's rows into it. A break, or a period with
    no effective slot for the section on that date, is refused: there was no lesson
    to take a register for. So is every period register while `module.timetable`
    is off: its grid can no longer be edited or covered. `lessons`
    is ``effective_lessons`` for this section, session and date when the caller
    already has it (the view does, for the marker check), so the timetable is
    read once per request.
    """
    assert_period_fits_mode(period=period)
    assert_session_contains(session=session, on_date=on_date)
    if period is None:
        return
    if not is_feature_enabled(TIMETABLE_FEATURE, tenant_id=section.tenant_id):
        raise DomainRuleViolation({"period_id": TIMETABLE_REQUIRED})
    if period.is_break:
        raise DomainRuleViolation({"period_id": f"{period.name} is a break, not a lesson."})
    if lessons is None:
        lessons = effective_lessons(session=session, section_ids=[section.pk], on_date=on_date)
    if (section.pk, period.pk) not in lessons:
        raise DomainRuleViolation(
            {"period_id": f"This section has no lesson in {period.name} on {on_date}."}
        )


def is_locked(
    attendance_date: datetime.date,
    *,
    today: datetime.date | None = None,
    window_days: int | None = None,
) -> bool:
    """§5.5 — a row past the lock window is edited only through a correction.

    Computed from the date rather than read from the ``is_locked`` column so the
    answer is right the moment the window passes. The column is the *persisted*
    view of the same thing, swept nightly, and exists so a client can render the
    state without recomputing it per row. ``window_days`` lets a caller checking
    many rows read the setting once.
    """
    today = today or timezone.localdate()
    window = lock_window_days() if window_days is None else window_days
    return attendance_date < today - datetime.timedelta(days=window)


class DateIssue(NamedTuple):
    """Why a date cannot be marked: one of the `UNMARKABLE_*` reasons."""

    reason: str
    holiday_name: str | None = None


def unmarkable_date_issue(
    *, on_date: datetime.date, campus_id: uuid.UUID | None
) -> DateIssue | None:
    """§11's calendar refusals as data, so the register renders read-only instead of failing."""
    if on_date > timezone.localdate():
        return DateIssue(UNMARKABLE_FUTURE)
    holiday = calendar.holiday_name(on_date, campus_id=campus_id)
    if holiday is not None:
        return DateIssue(UNMARKABLE_HOLIDAY, holiday)
    if not calendar.is_working_day(on_date, campus_id=campus_id):
        return DateIssue(UNMARKABLE_NON_WORKING_DAY)
    return None


def assert_markable_date(*, on_date: datetime.date, campus_id: uuid.UUID | None) -> None:
    """§11 — not in the future, not a weekend, not a holiday.

    The holiday case names the holiday. A teacher told only "this date cannot be
    marked" retries; one told "this is Founders Day" stops.
    """
    issue = unmarkable_date_issue(on_date=on_date, campus_id=campus_id)
    if issue is None:
        return
    messages = {
        UNMARKABLE_FUTURE: "Attendance records what happened; it cannot be marked ahead.",
        UNMARKABLE_HOLIDAY: f"{on_date} is {issue.holiday_name}; the school is closed.",
        UNMARKABLE_NON_WORKING_DAY: f"{on_date} is not a working day for this school.",
    }
    raise DomainRuleViolation({"attendance_date": messages[issue.reason]})


# ---------------------------------------------------------------------------
# The roster
# ---------------------------------------------------------------------------


def roster_enrollments(*, section: Section, session: AcademicSession) -> list[StudentEnrollment]:
    """The active enrollments a register covers, each with its student, in register order.

    Ordered by roll number then name so the register renders in the order a
    teacher reads a class list, with unnumbered students last rather than first.
    Shorter roll numbers sort first because `roll_number` is text: "2" then
    "10", not "10" then "2". A soft-deleted student is left out, which the
    enrollment's own `.alive()` does not do (see `_enrolled_student_ids`).
    """
    return list(
        StudentEnrollment.objects.alive()
        .filter(
            section=section,
            academic_session=session,
            status=EnrollmentStatus.ACTIVE,
            student__deleted_at__isnull=True,
        )
        .select_related("student")
        .order_by(
            Length("roll_number").asc(nulls_last=True),
            F("roll_number").asc(nulls_last=True),
            "student__first_name",
            "student__last_name",
        )
    )


def _enrolled_student_ids(*, section: Section, session: AcademicSession) -> set[uuid.UUID]:
    """The student ids a register submission may legitimately name.

    `student__deleted_at__isnull=True` is not redundant with `.alive()`: that
    narrows the *enrollment*, and a soft-deleted student can still hold a live
    enrollment row — nothing cascades the flag. Without it a deleted student
    stayed markable, which `roster_enrollments` already excluded, so the roster a
    teacher was shown and the roster the validator accepted disagreed.
    """
    return set(
        StudentEnrollment.objects.alive()
        .filter(
            section=section,
            academic_session=session,
            status=EnrollmentStatus.ACTIVE,
            student__deleted_at__isnull=True,
        )
        .values_list("student_id", flat=True)
    )


# ---------------------------------------------------------------------------
# Marking
# ---------------------------------------------------------------------------


def _resolve_times(
    entry: dict, *, campus_id: uuid.UUID | None, period: Period | None
) -> tuple[datetime.time | None, int | None]:
    """Check-in time and the lateness it implies.

    §11: "late/early minutes computed server-side, never client-supplied". A
    client-sent `late_minutes` is discarded rather than validated — validating it
    would still let a caller decide the number, and the punctuality report (§13)
    is only worth reading if every row was measured the same way.
    """
    check_in = entry.get("check_in_time")
    if entry.get("status") != AttendanceStatus.LATE or check_in is None:
        return check_in, None
    return check_in, late_minutes_for(check_in, period=period, campus_id=campus_id)


def late_minutes_for(
    check_in: datetime.time, *, period: Period | None, campus_id: uuid.UUID | None
) -> int:
    """A period row is late from its period's start; a daily row from the day's start."""
    if period is not None:
        return calendar.late_minutes_from(period.start_time, check_in, campus_id=campus_id)
    return calendar.late_minutes(check_in, campus_id=campus_id)


# The fields a register submission writes. Named once because they were written
# out three times — constructor kwargs, attribute assignments, and the
# `bulk_update` field list — with nothing keeping the three in step. `section`
# and `academic_session` are in the list deliberately: see `_apply_register`.
REGISTER_WRITE_FIELDS = (
    "section",
    "academic_session",
    "status",
    "check_in_time",
    "check_out_time",
    "late_minutes",
    "remarks",
    "marked_by",
    "updated_by",
)


def _lock_existing_rows(
    *, student_ids: set[uuid.UUID], on_date: datetime.date, period: Period | None
) -> dict[uuid.UUID, StudentAttendance]:
    """The rows this submission will update, locked for the transaction.

    Keyed on (student, date, period) and **not** on section, which is what the
    unique indexes key on too — so a student who changed section mid-session has
    one row for the date, not one per section they passed through.
    """
    return {
        row.student_id: row
        for row in StudentAttendance.objects.alive()
        .filter(student_id__in=student_ids, attendance_date=on_date, period=period)
        .select_for_update()
    }


def _apply_register(
    *,
    entries: list[dict],
    existing: dict[uuid.UUID, StudentAttendance],
    section: Section,
    session: AcademicSession,
    on_date: datetime.date,
    period: Period | None,
    actor_id: uuid.UUID,
) -> tuple[list[StudentAttendance], list[StudentAttendance], list[StudentAttendance]]:
    """Turn a submission into rows to create and rows to update.

    Returns `(created, updated, transitioned)`. `transitioned` is the subset
    whose status *changed* — a new row always counts, an updated one only if its
    status moved — and it is what the alert fan-out reads, so a resubmitted
    register does not re-notify every guardian.

    **An updated row has its `section` and `academic_session` reassigned.** The
    lookup matches on (student, date, period) because that is what the unique
    indexes enforce, so a student transferred between sections mid-session is
    found by whoever marks them next. Leaving `section` alone left the row
    pointing at the section they had left, which put the mark on the wrong
    teacher's register and inside the wrong campus scope. The section of record
    is the one it was marked in.
    """
    created: list[StudentAttendance] = []
    updated: list[StudentAttendance] = []
    transitioned: list[StudentAttendance] = []

    for entry in entries:
        check_in, late = _resolve_times(entry, campus_id=section.campus_id, period=period)
        values = {
            "section": section,
            "academic_session": session,
            "status": entry["status"],
            "check_in_time": check_in,
            "check_out_time": entry.get("check_out_time"),
            "late_minutes": late,
            "remarks": entry.get("remarks"),
            "marked_by": actor_id,
            "updated_by": actor_id,
        }
        row = existing.get(entry["student_id"])
        if row is None:
            fresh = StudentAttendance(
                tenant_id=section.tenant_id,
                student_id=entry["student_id"],
                period=period,
                attendance_date=on_date,
                source=AttendanceSource.MANUAL,
                created_by=actor_id,
                **values,
            )
            created.append(fresh)
            transitioned.append(fresh)
            continue

        changed = row.status != values["status"]
        for field, value in values.items():
            setattr(row, field, value)
        updated.append(row)
        if changed:
            transitioned.append(row)

    return created, updated, transitioned


@transaction.atomic
def bulk_mark_student_attendance(
    *,
    section: Section,
    session: AcademicSession,
    on_date: datetime.date,
    period: Period | None,
    entries: list[dict],
    actor_id: uuid.UUID,
    lessons: dict[tuple[uuid.UUID, uuid.UUID], LessonCell] | None = None,
) -> dict:
    """§16's ``POST /student-attendance:bulk-mark`` — one section, one date.

    **Upsert, not insert.** §6 requires the submission to be idempotent per
    (student, date, period) because a teacher's phone retries. A ``bulk_create``
    would hit ``student_attendance_one_per_day`` on the second attempt and fail
    the whole register.

    **Partial success is real, and reported rather than hidden.** One student
    transferred out this morning must not cost the teacher the other thirty-nine
    marks, so unknown or unenrolled students come back in ``error.meta.rows``
    while nothing commits — the structured-meta path ``core.api.exceptions``
    already carries, and which ``tests/test_api_contract.py`` reserved naming
    this exact case. Nothing commits because the whole call is atomic: a teacher
    who resubmits after fixing one row must not double-apply the other thirty-nine
    — which the upsert makes safe anyway, but a half-applied register is a state
    no one asked for.

    ``select_for_update`` on the rows that already exist: two devices submitting
    the same register within milliseconds both read "no row" otherwise, and the
    partial unique index turns the loser into a 500 rather than an update.

    **One mode at a time** (ADR-0028): a `period` only in period mode, and there
    only for a lesson the section had that date. The importer and approved-leave
    auto-marking stay mode-agnostic and keep writing daily rows. `lessons` passes
    through to ``assert_register_period``.
    """
    assert_session_writable(session)
    assert_markable_date(on_date=on_date, campus_id=section.campus_id)
    assert_register_period(
        session=session, section=section, period=period, on_date=on_date, lessons=lessons
    )

    if not entries:
        raise DomainRuleViolation({"entries": "A register with no rows marks nothing."})

    enrolled = _enrolled_student_ids(section=section, session=session)
    seen: set[uuid.UUID] = set()
    problems: list[dict] = []

    for entry in entries:
        student_id = entry["student_id"]
        if student_id in seen:
            problems.append(
                {"student_id": str(student_id), "issue": "Listed more than once in this register."}
            )
        seen.add(student_id)
        if student_id not in enrolled:
            problems.append(
                {
                    "student_id": str(student_id),
                    "issue": "Not actively enrolled in this section for this session.",
                }
            )
        if entry.get("status") in SYSTEM_ONLY_STATUSES:
            problems.append(
                {
                    "student_id": str(student_id),
                    "issue": (
                        "'on_leave' is written by an approved leave request, "
                        "not marked at the register."
                    ),
                }
            )

    if problems:
        raise DomainRuleViolation(
            {"entries": "Some rows could not be marked; the register was not saved."},
            meta={"rows": problems},
        )

    existing = _lock_existing_rows(student_ids=seen, on_date=on_date, period=period)

    locked = [
        str(student_id)
        for student_id, row in existing.items()
        if row.is_locked or is_locked(row.attendance_date)
    ]
    if locked:
        raise Conflict(
            "Some of these records are locked and must be changed through a correction request.",
        )

    # The guard in the *other* direction. `apply_approved_leave` already refuses
    # to overwrite a date a teacher has marked; without this, marking silently
    # overwrote an approved-leave day — leaving `leave_request` pointing at a
    # request whose dates the row no longer reflects, so the leave module had a
    # row it believed it owned and would withdraw on cancellation, showing a
    # status nobody had asked it to hold.
    #
    # Refused rather than reconciled: the two possible reconciliations are
    # "clear the link" (which loses the fact that leave was approved) and
    # "cancel the leave" (which is a decision, not a side effect of taking a
    # register). Naming the request lets the teacher do the second deliberately.
    #
    # In a period register the leave is the *daily* row approved leave writes, so
    # the server, not the screen, keeps an on-leave student out of every period
    # that day — and out of the absence alert a period mark would send.
    on_leave_ids = {
        student_id
        for student_id, row in existing.items()
        if row.status == AttendanceStatus.ON_LEAVE
    }
    if period is not None:
        on_leave_ids |= _daily_leave_student_ids(student_ids=seen, on_date=on_date)
    on_leave = [
        {"student_id": str(entry["student_id"]), "issue": ON_APPROVED_LEAVE}
        for entry in entries
        if entry["student_id"] in on_leave_ids
    ]
    if on_leave:
        raise DomainRuleViolation(
            {"entries": "Some students are on approved leave; the register was not saved."},
            meta={"rows": on_leave},
        )

    created, updated, transitioned = _apply_register(
        entries=entries,
        existing=existing,
        section=section,
        session=session,
        on_date=on_date,
        period=period,
        actor_id=actor_id,
    )

    try:
        with transaction.atomic():
            if created:
                StudentAttendance.objects.bulk_create(created)
    except IntegrityError:
        # Another submission inserted one of these keys between our lookup and
        # our insert. `select_for_update` cannot prevent this: there is no row
        # yet to lock, so both transactions read "absent" and both insert, and
        # the partial unique index picks a winner. Re-reading and turning the
        # losers into updates is what makes §6's idempotency promise hold for a
        # genuinely simultaneous double-submit rather than only for a sequential
        # retry — which is the case a teacher's phone on flaky Wi-Fi actually
        # produces. One retry, not a loop: the second pass locks the rows that
        # now exist, so there is no third outcome to wait for.
        existing = _lock_existing_rows(student_ids=seen, on_date=on_date, period=period)
        created, updated, transitioned = _apply_register(
            entries=entries,
            existing=existing,
            section=section,
            session=session,
            on_date=on_date,
            period=period,
            actor_id=actor_id,
        )
        if created:
            StudentAttendance.objects.bulk_create(created)

    if updated:
        StudentAttendance.objects.bulk_update(updated, [*REGISTER_WRITE_FIELDS, "updated_at"])

    rows = [*created, *updated]
    # **Only rows that actually *became* absent or late.** Alerting on current
    # status re-sent every guardian the same message on every retry — and §6
    # requires retries, so the module's own idempotency promise was what made it
    # a repeat-notification bug rather than a rare one. `transitioned` holds the
    # rows whose status actually changed, so a resubmitted register with the same
    # marks queues nothing. A register backfilled for a date past the lock window
    # writes its rows but alerts no one: a guardian must not hear of a weeks-old
    # absence as news.
    alerts = (
        []
        if is_locked(on_date)
        else _first_alerts_of_the_day(
            [row for row in transitioned if row.status in ALERT_STATUSES],
            on_date=on_date,
            written=rows,
        )
    )
    if alerts:
        _queue_alerts(tenant_id=section.tenant_id, rows=alerts)

    return {
        "marked": len(created),
        "updated": len(updated),
        "rows": rows,
        "alerts": alerts,
    }


def _daily_leave_student_ids(
    *, student_ids: set[uuid.UUID], on_date: datetime.date
) -> set[uuid.UUID]:
    """The students with a daily `on_leave` row on `on_date`, which approved leave writes."""
    return set(
        StudentAttendance.objects.alive()
        .filter(
            student_id__in=student_ids,
            attendance_date=on_date,
            period__isnull=True,
            status=AttendanceStatus.ON_LEAVE,
        )
        .values_list("student_id", flat=True)
    )


def _first_alerts_of_the_day(
    candidates: list[StudentAttendance],
    *,
    on_date: datetime.date,
    written: list[StudentAttendance],
) -> list[StudentAttendance]:
    """One alert per (student, date, event): drop a candidate whose event already happened.

    In period mode a student absent from P1 and P2 is one absence to a guardian,
    not two. Any other row that date counts — another period, or a daily row
    written before a switch. Late and absent are separate events: late in P1
    then absent in P3 sends both (§12 lists them as two). One query.

    It reads committed rows, so two registers for the same student submitted at
    the same moment (P1 and P2 from two devices) can each see no earlier absence
    and both alert. Accepted: the cost is a duplicate alert, not a missing one.
    """
    if not candidates:
        return []
    already = set(
        StudentAttendance.objects.alive()
        .filter(
            student_id__in={row.student_id for row in candidates},
            attendance_date=on_date,
            status__in=ALERT_STATUSES,
        )
        .exclude(pk__in=[row.pk for row in written])
        .values_list("student_id", "status")
    )
    return [row for row in candidates if (row.student_id, row.status) not in already]


def _queue_alerts(*, tenant_id: uuid.UUID, rows: list[StudentAttendance]) -> None:
    """Fan §12's guardian alerts out after the register commits, never before.

    ``on_commit``, not an inline call: the register is the outcome the teacher
    asked for, and a broker that is down must not roll it back. It also means no
    alert is ever sent for a register that failed a later row check and rolled
    back — which an inline enqueue would do, since Celery has no transaction to
    take part in.
    """
    from apps.attendance.tasks import send_attendance_alerts

    attendance_ids = [str(row.pk) for row in rows]
    transaction.on_commit(
        lambda: send_attendance_alerts.delay(
            tenant_id=str(tenant_id), attendance_ids=attendance_ids
        )
    )


# ---------------------------------------------------------------------------
# Corrections
# ---------------------------------------------------------------------------

CORRECTABLE_FIELDS = ("status", "check_in_time", "check_out_time", "remarks")
# A staff day's correctable values: its status and its times (the times feed payroll).
STAFF_CORRECTABLE_FIELDS = ("status", "check_in_time", "check_out_time")

CORRECTION_STILL_EDITABLE = (
    "This record is still within the marking window; edit the register instead."
)
CHECK_OUT_BEFORE_CHECK_IN = "Check-out must be later than check-in (§11)."
OWN_ATTENDANCE_CORRECTION = "An approver cannot decide a correction to their own attendance (§11)."


def correction_target_field(target: StudentAttendance | StaffAttendance) -> str:
    """The request field that names `target`: `student_attendance_id` or `staff_attendance_id`."""
    return "staff_attendance_id" if isinstance(target, StaffAttendance) else "student_attendance_id"


def correctable_fields(target: StudentAttendance | StaffAttendance) -> tuple[str, ...]:
    """The fields a correction may propose for `target`'s kind of row."""
    return STAFF_CORRECTABLE_FIELDS if isinstance(target, StaffAttendance) else CORRECTABLE_FIELDS


def request_correction(
    *,
    target: StudentAttendance | StaffAttendance,
    new_values: dict,
    reason: str,
    actor_id: uuid.UUID,
) -> AttendanceCorrection:
    """§5.5 — a locked row is changed only through an approved correction.

    Refuses an *unlocked* row deliberately: while a row is still editable the
    teacher can simply re-mark it, and a correction raised against it would sit
    in an approver's queue asking them to authorise something the requester
    could already do. The target is a student row or a staff row; `subject_type`
    follows from which.
    """
    if not (target.is_locked or is_locked(target.attendance_date)):
        raise DomainRuleViolation({correction_target_field(target): CORRECTION_STILL_EDITABLE})

    fields = correctable_fields(target)
    proposed = {field: new_values[field] for field in fields if field in new_values}
    if proposed.get("status") in SYSTEM_ONLY_STATUSES:
        # The same rule the register enforces, and it has to hold here too: a
        # correction is the *other* write path onto an attendance row, and
        # `on_leave` means "there is an approved leave request". Reachable
        # through a correction, it would set the status with no `leave_request`
        # to back it — the back-link would be a lie and the leave module would
        # have no row to withdraw on cancellation.
        raise DomainRuleViolation(
            {"new_values": ("'on_leave' is set by an approved leave request, not by a correction.")}
        )
    if not proposed:
        raise DomainRuleViolation({"new_values": f"Name at least one of: {', '.join(fields)}."})

    # Compared *after* normalisation, not before. The serializer stores times as
    # ISO strings (so `_from_json` reads back exactly what a TimeField wrote),
    # while `getattr` returns `datetime.time` — so a raw comparison of those two
    # fields was never equal and the "values must differ" rule silently never
    # fired for a time-only correction.
    old = {field: getattr(target, field) for field in proposed}
    if _to_json(old) == _to_json(proposed):
        raise DomainRuleViolation({"new_values": "The proposed values match the record (§11)."})
    is_staff = isinstance(target, StaffAttendance)
    if is_staff:
        # The table's CHECK would refuse it at `:approve` as a 500; refuse it here, by name.
        _assert_check_out_after_check_in(target, _to_json(proposed))

    return AttendanceCorrection.objects.create(
        tenant_id=target.tenant_id,
        subject_type=CorrectionSubjectType.STAFF if is_staff else CorrectionSubjectType.STUDENT,
        student_attendance=None if is_staff else target,
        staff_attendance=target if is_staff else None,
        requested_by=actor_id,
        old_values=_to_json(old),
        new_values=_to_json(proposed),
        reason=reason,
        created_by=actor_id,
        updated_by=actor_id,
    )


@transaction.atomic
def decide_correction(
    *,
    correction: AttendanceCorrection,
    approve: bool,
    reviewer_id: uuid.UUID,
    note: str | None = None,
) -> AttendanceCorrection:
    """§11 — the approver is neither the requester nor a staff correction's subject.

    Segregation of duties (auth-and-rbac §2.4). Checked here rather than in the
    viewset because the rule is the module's, not HTTP's: the same check has to
    hold when hr-leave later approves through its own endpoint, and when a bulk
    approval screen calls this in a loop.

    An approved correction applies ``new_values`` to the target **and the
    correction row stays**: §6 makes the row itself the audit trail, so it is
    never deleted and never rewritten.

    **The correction row is locked before its status is read.** Only the target
    attendance row was locked before, which left the decision itself racy: two
    reviewers deciding the same correction in the same window both passed the
    PENDING check, and the later commit won — so a correction could persist as
    `rejected` after a concurrent `:approve` had already mutated the attendance
    row and recomputed `late_minutes`. That is exactly the audit-trail guarantee
    §6 asks this row to carry, so the lock belongs on the row that carries it.
    """
    # No `select_related` here: `student_attendance` is nullable, so Django joins
    # it with a LEFT OUTER JOIN and PostgreSQL refuses `FOR UPDATE` on the
    # nullable side of one. The target is fetched — and separately locked — by
    # `_apply_correction`, which is the only place that needs it.
    correction = AttendanceCorrection.objects.select_for_update().get(pk=correction.pk)
    if correction.status != CorrectionStatus.PENDING:
        raise Conflict(f"This correction was already {correction.status}.")
    if correction.requested_by == reviewer_id:
        raise DomainRuleViolation(
            {"reviewed_by": "An approver cannot decide their own correction request (§11)."}
        )
    # The same rule from the other side: a second person raising it does not let the
    # staff member approve a change to their own payroll inputs.
    if (
        correction.staff_attendance_id is not None
        and StaffAttendance.objects.filter(
            pk=correction.staff_attendance_id, staff__user_id=reviewer_id
        ).exists()
    ):
        raise DomainRuleViolation({"reviewed_by": OWN_ATTENDANCE_CORRECTION})

    correction.status = CorrectionStatus.APPROVED if approve else CorrectionStatus.REJECTED
    correction.reviewed_by = reviewer_id
    correction.reviewed_at = timezone.now()
    correction.review_note = note
    correction.updated_by = reviewer_id
    correction.save(
        update_fields=[
            "status",
            "reviewed_by",
            "reviewed_at",
            "review_note",
            "updated_by",
            "updated_at",
        ]
    )

    if approve:
        _apply_correction(correction=correction, reviewer_id=reviewer_id)

    return correction


def _apply_correction(*, correction: AttendanceCorrection, reviewer_id: uuid.UUID) -> None:
    """Write an approved correction onto its target row.

    **`late_minutes` is recomputed, not carried over.** It is not a correctable
    field — §11 computes it server-side — so a correction that changes `status`
    to `late` or moves `check_in_time` left the old value in place: a row
    corrected from absent to late reported zero minutes late, and §13's
    punctuality report summed those zeros. Recomputing here is the same call the
    register makes, so both write paths agree — a period row from its period's start.
    A staff row recomputes both its late and early-departure minutes from the
    staff day window, as ``mark_staff_attendance`` does.
    """
    if correction.staff_attendance_id is not None:
        _apply_staff_correction(correction=correction, reviewer_id=reviewer_id)
        return

    target = StudentAttendance.objects.select_for_update().get(pk=correction.student_attendance_id)
    for field, value in correction.new_values.items():
        setattr(target, field, _from_json(field, value))

    target.late_minutes = (
        late_minutes_for(
            target.check_in_time, period=target.period, campus_id=target.section.campus_id
        )
        if target.status == AttendanceStatus.LATE and target.check_in_time is not None
        else None
    )
    target.updated_by = reviewer_id
    target.save(update_fields=[*correction.new_values, "late_minutes", "updated_by", "updated_at"])


def _apply_staff_correction(*, correction: AttendanceCorrection, reviewer_id: uuid.UUID) -> None:
    """Write an approved staff correction, recomputing both minutes from the staff day window.

    The times are re-checked against the row as it is now: another correction
    approved since this one was raised may have moved the other time.
    """
    target = (
        # Locks the attendance row only; the joined staff row is read, not written.
        StaffAttendance.objects.select_for_update(of=("self",))
        .select_related("staff")
        .get(pk=correction.staff_attendance_id)
    )
    _assert_check_out_after_check_in(target, correction.new_values)
    for field, value in correction.new_values.items():
        setattr(target, field, _from_json(field, value))

    minutes = staff_minutes(
        status=target.status,
        check_in_time=target.check_in_time,
        check_out_time=target.check_out_time,
        campus_id=_staff_campus_id(target.staff),
    )
    for field, value in minutes.items():
        setattr(target, field, value)
    target.updated_by = reviewer_id
    target.save(update_fields=[*correction.new_values, *minutes, "updated_by", "updated_at"])


def _assert_check_out_after_check_in(target: StaffAttendance, proposed: dict) -> None:
    """§11 over the row as a correction would leave it: check-out after check-in."""
    check_in = _from_json("check_in_time", proposed.get("check_in_time", target.check_in_time))
    check_out = _from_json("check_out_time", proposed.get("check_out_time", target.check_out_time))
    if check_in is not None and check_out is not None and check_out <= check_in:
        raise DomainRuleViolation({"new_values": CHECK_OUT_BEFORE_CHECK_IN})


def _to_json(values: dict) -> dict:
    """JSONB cannot hold a `time`; store the ISO string it round-trips through."""
    return {
        field: value.isoformat() if isinstance(value, datetime.time) else value
        for field, value in values.items()
    }


def _from_json(field: str, value):
    """Parse a stored value back to its column type.

    Defensive rather than trusting: these rows are JSONB written when the
    correction was *raised*, and an approval can be days later. A value that
    cannot be parsed raises a 422 naming the field instead of an uncaught
    `ValueError` — which surfaced as a 500 on `:approve`, long after the request
    that introduced it, with the malformed value invisible in the response.
    """
    if field in ("check_in_time", "check_out_time") and isinstance(value, str):
        try:
            return datetime.time.fromisoformat(value)
        except ValueError as exc:
            raise DomainRuleViolation(
                {field: f"'{value}' is not a valid time; this correction cannot be applied."}
            ) from exc
    return value


# ---------------------------------------------------------------------------
# Student leave (§5.4, §7.2)
# ---------------------------------------------------------------------------

STUDENT_LEAVE_APPROVE = "attendance.leave-request.approve"

# §8's journey names the case: "a two-week request escalates automatically to the
# vice principal". Ten working days is that fortnight, and it is the only number
# the module doc gives — a default that can be pointed at beats one invented here.
DEFAULT_ESCALATION_THRESHOLD_DAYS = 10

# The statuses that occupy a person's calendar. A cancelled or rejected request
# holds nothing, so a second request over the same dates must be allowed — §11's
# overlap rule is about live claims, not about history.
LIVE_LEAVE_STATUSES = frozenset({LeaveStatus.PENDING, LeaveStatus.APPROVED})


def leave_approval_config(academic: dict) -> dict:
    """`academic.student_leave_approval`, or an empty dict when missing or malformed."""
    config = academic.get(LEAVE_APPROVAL_SETTING)
    return config if isinstance(config, dict) else {}


def escalation_threshold_days() -> int:
    """Above this many days, a student leave request needs a second approval.

    Tenant-configurable per multi-tenancy §5 — the approval chain is
    configuration, not a constant — but read defensively: zero would escalate
    every single-day absence and make the second approver's queue useless, so it
    is floored at one.
    """
    return escalation_threshold_days_from(_academic_settings())


def escalation_threshold_days_from(academic: dict) -> int:
    """``escalation_threshold_days`` over an already-loaded `academic` dict."""
    configured = leave_approval_config(academic).get(ESCALATION_THRESHOLD_SETTING)
    if not isinstance(configured, int) or isinstance(configured, bool):
        return DEFAULT_ESCALATION_THRESHOLD_DAYS
    return max(configured, 1)


def student_leave_chain(days_count) -> list[dict]:
    """The §7.2 chain for a request of this length.

    Two levels at most, and **both take the same permission key**, which is worth
    stating because it looks like a mistake: §4 grants
    `attendance.leave-request.approve` to `class_teacher`, `vice_principal` and
    `principal` alike. What separates level 1 from level 2 is not the key but the
    *record scope* a holder has — a class teacher is `assigned`-scoped to their
    own sections, a vice principal `all`-scoped — plus the rule in
    `decide_leave_step` that the two levels cannot be decided by the same person.
    Without that rule the escalation would be theatre: the class teacher who
    approved level 1 could approve level 2 and the threshold would mean nothing.
    """
    chain = [{"level": 1, "required_permission": STUDENT_LEAVE_APPROVE}]
    if days_count > escalation_threshold_days():
        chain.append({"level": 2, "required_permission": STUDENT_LEAVE_APPROVE})
    return chain


def leave_days_between(
    start: datetime.date, end: datetime.date, *, day_part: str, campus_id: uuid.UUID | None
):
    """§11's `days_count`, net of holidays and non-working days.

    Computed, never taken from the client. A request that counted a Sunday would
    be a false attendance record for a student and — once hr-leave consumes the
    same column — a balance error for a staff member.

    A half-day is only meaningful on a single date: `day_part` describes which
    half of *a* day, and applying it to a range would silently mean "half of every
    day in it", which no caller means and §6 does not describe.
    """
    days = [
        start + datetime.timedelta(days=offset)
        for offset in range((end - start).days + 1)
        if calendar.is_working_day(start + datetime.timedelta(days=offset), campus_id=campus_id)
    ]
    count = Decimal(len(days))
    if count == 1 and day_part != DayPart.FULL:
        return Decimal("0.5")
    return count


def assert_may_request_for_student(*, user, student: Student) -> None:
    """§11 — "requester must be the student or a linked guardian".

    Resolved through `Student.filter_owned_by_user`, the same hook the read scope
    uses, so a guardian whose portal access was revoked cannot submit on a child's
    behalf either. Two rules that must agree, implemented once.
    """
    visible = Student.filter_owned_by_user(Student.objects.alive(), user)
    if not visible.filter(pk=student.pk).exists():
        raise DomainRuleViolation(
            {"student_id": "You may only request leave for yourself or a child you are linked to."}
        )


def assert_no_overlapping_leave(
    *, student: Student, start: datetime.date, end: datetime.date, exclude_pk=None
) -> None:
    """§11 — no overlap with an existing approved or pending request."""
    clashes = LeaveRequest.objects.alive().filter(
        student=student,
        status__in=LIVE_LEAVE_STATUSES,
        start_date__lte=end,
        end_date__gte=start,
    )
    if exclude_pk is not None:
        clashes = clashes.exclude(pk=exclude_pk)

    clash = clashes.first()
    if clash is not None:
        raise DomainRuleViolation(
            {
                "start_date": (
                    f"This overlaps a {clash.status} request for "
                    f"{clash.start_date} – {clash.end_date}."
                )
            }
        )


@transaction.atomic
def submit_leave_request(
    *,
    student: Student,
    leave_type: LeaveType,
    start_date: datetime.date,
    end_date: datetime.date,
    day_part: str,
    reason: str,
    attachment_file=None,
    submitted_by: uuid.UUID,
    requesting_user,
) -> LeaveRequest:
    """§5.4 — a guardian or student raises a request, and its chain is built with it.

    The whole chain is materialised now rather than a step at a time, so the
    requester can see how many decisions stand between them and an answer, and so
    `current_approval_level` always points at a row that exists.
    """
    assert_may_request_for_student(user=requesting_user, student=student)

    if not leave_type.allows_students:
        raise DomainRuleViolation(
            {"leave_type_id": f"'{leave_type.name}' is not a leave type students may request."}
        )
    if not leave_type.is_active:
        raise DomainRuleViolation({"leave_type_id": f"'{leave_type.name}' is no longer offered."})
    if end_date < start_date:
        raise DomainRuleViolation({"end_date": "Leave cannot end before it starts."})
    if leave_type.requires_attachment and attachment_file is None:
        raise DomainRuleViolation(
            {"attachment_file_id": f"'{leave_type.name}' requires a supporting document."}
        )
    if attachment_file is not None:
        assert_file_usable(file=attachment_file, purpose=uploads.LEAVE_ATTACHMENT.key)

    assert_no_overlapping_leave(student=student, start=start_date, end=end_date)

    campus_id = student.campus_id
    days_count = leave_days_between(start_date, end_date, day_part=day_part, campus_id=campus_id)
    if days_count <= 0:
        raise DomainRuleViolation(
            {"start_date": "Those dates are all holidays or non-working days for this school."}
        )
    if leave_type.max_consecutive_days is not None and days_count > leave_type.max_consecutive_days:
        raise DomainRuleViolation(
            {
                "end_date": (
                    f"'{leave_type.name}' allows at most "
                    f"{leave_type.max_consecutive_days} consecutive days."
                )
            }
        )

    request = LeaveRequest.objects.create(
        tenant_id=student.tenant_id,
        requester_type=RequesterType.STUDENT,
        student=student,
        leave_type=leave_type,
        start_date=start_date,
        end_date=end_date,
        day_part=day_part,
        days_count=days_count,
        reason=reason,
        attachment_file=attachment_file,
        submitted_by=submitted_by,
        created_by=submitted_by,
        updated_by=submitted_by,
    )
    LeaveApproval.objects.bulk_create(
        [
            LeaveApproval(
                tenant_id=student.tenant_id,
                leave_request=request,
                level=step["level"],
                required_permission=step["required_permission"],
                created_by=submitted_by,
                updated_by=submitted_by,
            )
            for step in student_leave_chain(days_count)
        ]
    )
    _notify_leave_submitted(request=request)
    return request


@transaction.atomic
def decide_leave_step(
    *, request: LeaveRequest, approve: bool, approver_id: uuid.UUID, note: str | None = None
) -> LeaveRequest:
    """One step of §7.2's chain. Approving the last step approves the request.

    Three rules hold here rather than in the viewset, because the same three have
    to hold when hr-leave decides a staff request through its own endpoint:

    1. **The approver is not the submitter** (§11, RBAC §2.4).
    2. **No approver decides two levels of the same request.** Without this the
       escalation threshold means nothing — the class teacher who approved level
       1 could approve level 2 and the second opinion would be their own.
    3. **A rejection ends the request outright**, at whatever level it happens.
       §7.2's flowchart has one arrow out of a rejection and it goes to
       "Rejected + notification"; there is no partial rejection to represent.
    """
    request = LeaveRequest.objects.select_for_update().get(pk=request.pk)
    if request.status != LeaveStatus.PENDING:
        raise Conflict(f"This request was already {request.status}.")
    if request.submitted_by == approver_id:
        raise DomainRuleViolation(
            {"approver_id": "An approver cannot decide a request they submitted (§11)."}
        )

    step = request.approvals.alive().filter(level=request.current_approval_level).first()
    if step is None:
        raise Conflict("This request has no pending approval step.")
    if request.approvals.alive().filter(approver_id=approver_id).exists():
        raise DomainRuleViolation(
            {
                "approver_id": (
                    "You have already decided a step of this request; an escalation "
                    "needs a second person."
                )
            }
        )
    _assert_escalation_reaches_wider(step=step, user_id=approver_id)

    now = timezone.now()
    step.decision = ApprovalDecision.APPROVED if approve else ApprovalDecision.REJECTED
    step.approver_id = approver_id
    step.decided_at = now
    step.note = note
    step.updated_by = approver_id
    step.save(
        update_fields=["decision", "approver_id", "decided_at", "note", "updated_by", "updated_at"]
    )

    if not approve:
        request.status = LeaveStatus.REJECTED
        request.decided_at = now
    else:
        remaining = request.approvals.alive().filter(decision=ApprovalDecision.PENDING).count()
        if remaining:
            request.current_approval_level += 1
        else:
            request.status = LeaveStatus.APPROVED
            request.decided_at = now

    request.updated_by = approver_id
    request.save(
        update_fields=["status", "current_approval_level", "decided_at", "updated_by", "updated_at"]
    )

    if request.status == LeaveStatus.APPROVED:
        apply_approved_leave(request=request, actor_id=approver_id)
    if request.status in (LeaveStatus.APPROVED, LeaveStatus.REJECTED):
        _notify_leave_decision(request=request)

    return request


def _assert_escalation_reaches_wider(*, step: LeaveApproval, user_id: uuid.UUID) -> None:
    """Level 2 needs someone who can see more than level 1 could.

    "Two different people" was not enough on its own. §4 grants the approve key
    to `class_teacher`, `vice_principal` and `principal` alike, so two
    `assigned`-scoped class teachers with overlapping sections could take a
    level and a level — and a request that escalated *because it was long* would
    be decided entirely inside the scope that raised it, without the wider view
    §7.2 escalates to a vice principal precisely to obtain.

    So the second level requires a `campus` or `all` scope. Expressed as scope
    rather than as a role because roles are tenant-editable and scope is what
    actually determines what an approver can see — the same reason
    `student_leave_chain` keys both levels the same and lets scope separate them.
    """
    if step.level < 2:
        return

    from core.rbac.models import User

    reviewer = User.objects.filter(pk=user_id).first()
    scopes = user_scopes(reviewer) if reviewer is not None else {}
    if RecordScope.ALL in scopes or RecordScope.CAMPUS in scopes:
        return

    raise DomainRuleViolation(
        {
            "approver_id": (
                "This request escalated past the threshold and needs an approver "
                "with campus-wide or school-wide scope."
            )
        }
    )


@transaction.atomic
def cancel_leave_request(*, request: LeaveRequest, actor_id: uuid.UUID) -> LeaveRequest:
    """§6 — "cancellation allowed until start date".

    An approved request may be cancelled too, not only a pending one: a child who
    recovers early should come back to school without an `on_leave` row saying
    otherwise. The auto-marked rows are withdrawn with it, which is why this is
    not simply a status write.
    """
    request = LeaveRequest.objects.select_for_update().get(pk=request.pk)
    if request.status in (LeaveStatus.REJECTED, LeaveStatus.CANCELLED):
        raise Conflict(f"This request was already {request.status}.")
    if request.start_date <= timezone.localdate():
        raise DomainRuleViolation(
            {"start_date": "Leave can only be cancelled before it starts (§6)."}
        )

    _withdraw_auto_marked_rows(request=request, actor_id=actor_id)

    request.status = LeaveStatus.CANCELLED
    request.decided_at = timezone.now()
    request.updated_by = actor_id
    request.save(update_fields=["status", "decided_at", "updated_by", "updated_at"])
    return request


def apply_approved_leave(*, request: LeaveRequest, actor_id: uuid.UUID) -> int:
    """§7.2 — "dates auto-marked on_leave". Returns the number of rows written.

    Only working days get a row, and only where none already exists: a date the
    teacher already marked is left alone rather than overwritten, because a
    student who was recorded present is a fact and the approval is a claim about
    the future. Those dates are reported as skipped rather than silently ignored —
    `_LeaveMarkOutcome` carries the count so the caller can say so.

    Daily rows only, never per-period: the request is for whole dates, and
    fabricating a row per period would invent marks nobody made.

    Staff requests return early. `leave_requests` holds both kinds and
    `student` is therefore nullable; there is no staff register to write to
    until PR 3 ships `staff_attendance`, and mypy is right that reaching for
    `request.student.campus_id` on a staff row would crash. Guarded rather than
    cast, because the guard is also the honest description of what this does.
    """
    if request.student is None:
        return 0

    session = AcademicSession.objects.alive().filter(is_current=True).first()
    if session is None:
        # An approved request with nowhere to record it. Loud rather than silent:
        # the approval already happened and the register would quietly disagree.
        logger.warning(
            "leave %s approved with no current academic session; no rows auto-marked",
            request.pk,
        )
        return 0

    enrollment = (
        StudentEnrollment.objects.alive()
        .filter(student=request.student, academic_session=session, status=EnrollmentStatus.ACTIVE)
        .first()
    )
    if enrollment is None:
        logger.warning("leave %s approved for a student with no active enrollment", request.pk)
        return 0

    campus_id = request.student.campus_id
    dates = [
        request.start_date + datetime.timedelta(days=offset)
        for offset in range((request.end_date - request.start_date).days + 1)
    ]
    working = [day for day in dates if calendar.is_working_day(day, campus_id=campus_id)]
    already = set(
        StudentAttendance.objects.alive()
        .filter(student=request.student, attendance_date__in=working, period__isnull=True)
        .values_list("attendance_date", flat=True)
    )

    def _rows_for(dates: list[datetime.date]) -> list[StudentAttendance]:
        return [
            StudentAttendance(
                tenant_id=request.tenant_id,
                student=request.student,
                section=enrollment.section,
                academic_session=session,
                attendance_date=day,
                status=AttendanceStatus.ON_LEAVE,
                leave_request=request,
                source=AttendanceSource.SYSTEM,
                marked_by=actor_id,
                created_by=actor_id,
                updated_by=actor_id,
            )
            for day in dates
        ]

    pending = [day for day in working if day not in already]
    try:
        with transaction.atomic():
            StudentAttendance.objects.bulk_create(_rows_for(pending))
    except IntegrityError:
        # A teacher marked one of these dates between our read and our insert.
        # Without the savepoint this rolled back **the approval decision itself**
        # and 500'd the approver — the leave was refused because someone took a
        # register, which is not a relationship either action should have.
        #
        # The recovery is deliberately *not* an upsert: a date a teacher has
        # already marked is theirs, exactly as the read above already decided.
        # The retry narrows to what is still genuinely missing.
        already = set(
            StudentAttendance.objects.alive()
            .filter(student=request.student, attendance_date__in=working, period__isnull=True)
            .values_list("attendance_date", flat=True)
        )
        pending = [day for day in working if day not in already]
        StudentAttendance.objects.bulk_create(_rows_for(pending))

    return len(pending)


def _withdraw_auto_marked_rows(*, request: LeaveRequest, actor_id: uuid.UUID) -> int:
    """Soft-delete the `on_leave` rows this request wrote, and nothing else.

    Filtered on `leave_request` rather than on dates: a row a teacher marked
    themselves over the same range is not this request's to remove, and the
    back-link is the only thing that tells the two apart.
    """
    return (
        StudentAttendance.objects.alive()
        .filter(leave_request=request)
        .update(deleted_at=timezone.now(), updated_by=actor_id, updated_at=timezone.now())
    )


def _notify_leave_submitted(*, request: LeaveRequest) -> None:
    """§12 — tell the approvers at the current step. Never fails the submission.

    Swallowed and logged for the reason `staff_management._notify_invited` gives:
    the request is the outcome the guardian asked for, and a template or transport
    problem must not roll it back.
    """
    from apps.attendance import notifications

    try:
        with transaction.atomic():
            notifications.notify_leave_submitted(request=request)
    except Exception:
        logger.exception("leave-submitted notification failed for request %s", request.pk)


def _notify_leave_decision(*, request: LeaveRequest) -> None:
    from apps.attendance import notifications

    try:
        with transaction.atomic():
            notifications.notify_leave_decision(request=request)
    except Exception:
        logger.exception("leave-decision notification failed for request %s", request.pk)


# ---------------------------------------------------------------------------
# Staff attendance (§5.2, §5.3)
# ---------------------------------------------------------------------------

# The statuses that mean "this teacher is not taking their classes today", and so
# should offer cover. `holiday` is not one of them: the school is shut, there are
# no classes to cover. Neither is `half_day` — §7.2 has no notion of covering part
# of a day, and proposing whole-day cover for someone who is in for the morning
# would be worse than proposing none.
ABSENT_STAFF_STATUSES = frozenset({StaffAttendanceStatus.ABSENT, StaffAttendanceStatus.ON_LEAVE})


def _staff_campus_id(staff: Staff) -> uuid.UUID | None:
    return staff.campus_id


# The statuses of a day the person worked, so the only ones with late or early minutes.
STAFF_TIMED_STATUSES = frozenset(
    {StaffAttendanceStatus.PRESENT, StaffAttendanceStatus.LATE, StaffAttendanceStatus.HALF_DAY}
)


def staff_minutes(
    *,
    status: str,
    check_in_time: datetime.time | None,
    check_out_time: datetime.time | None,
    campus_id: uuid.UUID | None,
) -> dict[str, int | None]:
    """A staff day's computed minutes (§11): late from the day's start, early from its end.

    One computation for marking, check-out and an approved correction, so every
    write path measures a payroll input the same way. Only a day the person
    worked has minutes: an absent day that kept its times counts no early leave.
    """
    if status not in STAFF_TIMED_STATUSES:
        return {"late_minutes": None, "early_departure_minutes": None}
    return {
        "late_minutes": (
            calendar.late_minutes(check_in_time, campus_id=campus_id)
            if status == StaffAttendanceStatus.LATE and check_in_time is not None
            else None
        ),
        "early_departure_minutes": (
            calendar.early_departure_minutes(check_out_time, campus_id=campus_id)
            if check_out_time is not None
            else None
        ),
    }


@transaction.atomic
def mark_staff_attendance(
    *,
    staff: Staff,
    on_date: datetime.date,
    status: str,
    check_in_time: datetime.time | None = None,
    check_out_time: datetime.time | None = None,
    remarks: str | None = None,
    source: str = StaffAttendanceSource.MANUAL,
    actor_id: uuid.UUID,
) -> StaffAttendance:
    """§5.2 — one row per staff member per date. Upsert, like the student register.

    `late_minutes` and `early_departure_minutes` are computed here and a
    client-supplied value is discarded, for the reason §11 gives and the student
    path already follows: §13's punctuality report is a payroll input, and it is
    only worth reading if every row was measured the same way.

    Marking a teacher absent emits the substitution signal §18 declares — see
    `_propose_cover_for_absence`. On commit, never inline: cover is timetable's to
    decide, and a conflict there must not roll back the attendance record, which
    is the fact of the matter either way.
    """
    assert_markable_date(on_date=on_date, campus_id=_staff_campus_id(staff))

    if check_in_time and check_out_time and check_out_time <= check_in_time:
        raise DomainRuleViolation(
            {"check_out_time": "Check-out must be later than check-in (§11)."}
        )
    if status == StaffAttendanceStatus.ON_LEAVE:
        # The mirror of the student rule: `on_leave` means an approved leave
        # request exists, and hr-leave's approval writes it with the back-link.
        raise DomainRuleViolation(
            {"status": "'on_leave' is written by an approved leave request, not marked."}
        )

    campus_id = _staff_campus_id(staff)
    row = (
        StaffAttendance.objects.alive()
        .filter(staff=staff, attendance_date=on_date)
        .select_for_update()
        .first()
    )
    if row is not None and (row.is_locked or is_locked(row.attendance_date)):
        raise Conflict("This record is locked and must be changed through a correction request.")

    values = {
        "status": status,
        "check_in_time": check_in_time,
        "check_out_time": check_out_time,
        **staff_minutes(
            status=status,
            check_in_time=check_in_time,
            check_out_time=check_out_time,
            campus_id=campus_id,
        ),
        "remarks": remarks,
        "source": source,
        "marked_by": actor_id,
        "updated_by": actor_id,
    }

    was_absent = row is not None and row.status in ABSENT_STAFF_STATUSES
    if row is None:
        try:
            with transaction.atomic():
                row = StaffAttendance.objects.create(
                    tenant_id=staff.tenant_id,
                    staff=staff,
                    attendance_date=on_date,
                    created_by=actor_id,
                    **values,
                )
        except IntegrityError:
            # The same race the student register documents, and it reaches this
            # path more easily rather than less: §5.2's self check-in is a button
            # a person double-taps. `select_for_update` above cannot lock a row
            # that does not exist yet, so both requests read "absent" and both
            # insert; the unique index picks a winner and the loser has to
            # become an update rather than a 500.
            row = (
                StaffAttendance.objects.alive()
                .filter(staff=staff, attendance_date=on_date)
                .select_for_update()
                .get()
            )
            was_absent = row.status in ABSENT_STAFF_STATUSES
            for field, value in values.items():
                setattr(row, field, value)
            row.save(update_fields=[*values, "updated_at"])
    else:
        for field, value in values.items():
            setattr(row, field, value)
        row.save(update_fields=[*values, "updated_at"])

    # Only on a transition into absence, for the same reason the guardian alerts
    # are: re-recording an absence must not propose a second round of cover.
    if status in ABSENT_STAFF_STATUSES and not was_absent:
        _queue_cover_proposals(staff=staff, on_date=on_date, actor_id=actor_id)

    return row


@transaction.atomic
def check_out_staff(
    *, row: StaffAttendance, check_out_time: datetime.time, actor_id: uuid.UUID
) -> StaffAttendance:
    """§16's `POST /staff-attendance/{id}:check-out`.

    Its own action rather than a PATCH because §5.3 makes leaving a distinct
    event with its own time, and because the early-departure minutes it implies
    are computed, not sent.
    """
    # Re-read under a lock, like every other mutate-in-place path in this module.
    # Last-write-wins is a quieter failure than the IntegrityError the insert
    # race raises — two check-outs seconds apart simply keep the later one — but
    # `early_departure_minutes` is a payroll input, and "quietly the wrong
    # number" is the worse of the two outcomes to leave in.
    row = StaffAttendance.objects.select_for_update().select_related("staff").get(pk=row.pk)

    if row.check_in_time is None:
        raise DomainRuleViolation(
            {"check_out_time": "This record has no check-in to check out from."}
        )
    if check_out_time <= row.check_in_time:
        raise DomainRuleViolation(
            {"check_out_time": "Check-out must be later than check-in (§11)."}
        )
    if row.is_locked or is_locked(row.attendance_date):
        raise Conflict("This record is locked and must be changed through a correction.")

    row.check_out_time = check_out_time
    row.early_departure_minutes = staff_minutes(
        status=row.status,
        check_in_time=row.check_in_time,
        check_out_time=check_out_time,
        campus_id=_staff_campus_id(row.staff),
    )["early_departure_minutes"]
    row.updated_by = actor_id
    row.save(
        update_fields=[
            "check_out_time",
            "early_departure_minutes",
            "updated_by",
            "updated_at",
        ]
    )
    return row


def _queue_cover_proposals(*, staff: Staff, on_date: datetime.date, actor_id: uuid.UUID) -> None:
    """§18's outbound signal: an absent teacher's classes need cover.

    `on_commit`, and swallowed on failure by the task itself. Proposing cover is
    `timetable`'s decision and its rules can legitimately refuse — every eligible
    substitute may already be teaching — and none of that should undo the
    attendance record, which is the fact of the matter regardless of whether
    anyone can cover.
    """
    from apps.attendance.tasks import propose_cover_for_absence

    transaction.on_commit(
        lambda: propose_cover_for_absence.delay(
            tenant_id=str(staff.tenant_id),
            staff_id=str(staff.pk),
            on_date=on_date.isoformat(),
            actor_id=str(actor_id),
        )
    )


# ---------------------------------------------------------------------------
# Reports (§13)
# ---------------------------------------------------------------------------

# Above this many rows a report is built as a background job rather than served
# inline (api-architecture.md §2.7). Chosen against the shape of the data rather
# than a round number: a daily register is one section (~40 rows) and a term
# summary is one school's students (hundreds), while a *term's* register is
# students x days and runs to tens of thousands. The first two are a page; the
# third is a download.
SYNCHRONOUS_REPORT_ROW_LIMIT = 1000

REPORT_KINDS = (
    "daily-register",
    "student-summary",
    "defaulters",
    "student-late-arrivals",
    "staff-punctuality",
    "leave",
)


def staff_away_on(*, on_date: datetime.date) -> set[uuid.UUID]:
    """The staff who are not in school on `on_date`: on approved leave covering it, or
    marked absent or on leave in the staff register.

    Read-only, for another module that has to plan around them (timetable picks cover
    from everyone else). Two queries, whatever the size of the school.
    """
    on_leave = (
        LeaveRequest.objects.alive()
        .filter(
            requester_type=RequesterType.STAFF,
            status=LeaveStatus.APPROVED,
            start_date__lte=on_date,
            end_date__gte=on_date,
        )
        .values_list("staff_id", flat=True)
    )
    marked_away = (
        StaffAttendance.objects.alive()
        .filter(
            attendance_date=on_date,
            status__in=ABSENT_STAFF_STATUSES,
        )
        .values_list("staff_id", flat=True)
    )
    return {staff_id for staff_id in on_leave if staff_id} | set(marked_away)


def assert_report_range(*, start_date: datetime.date, end_date: datetime.date) -> None:
    if end_date < start_date:
        raise DomainRuleViolation({"end_date": "The range ends before it starts."})


# ---------------------------------------------------------------------------
# Historical import (§9)
# ---------------------------------------------------------------------------

# The template's exact header names. Exact, not mapped: `student-management`'s
# importer made the same call, and a column-mapping UI is a feature nobody has
# asked for — the file comes out of a previous system once, during onboarding.
IMPORT_COLUMNS = (
    "admission_number",
    "attendance_date",
    "status",
    "check_in_time",
    "check_out_time",
    "remarks",
)
REQUIRED_IMPORT_COLUMNS = ("admission_number", "attendance_date", "status")


def parse_attendance_import(*, filename: str, data: bytes) -> list[dict[str, str]]:
    """Parse a CSV or .xlsx register into row dicts keyed by IMPORT_COLUMNS.

    Delegates to `core.imports.tabular`, the parser every importer shares; a file
    missing a required header fails once, readably, rather than once per row.
    """
    return parse_rows(filename=filename, data=data, required_columns=REQUIRED_IMPORT_COLUMNS)


def import_attendance_row(
    *,
    row: dict[str, str],
    row_number: int,
    session: AcademicSession,
    tenant_id: uuid.UUID,
    actor_id: uuid.UUID,
) -> dict[str, str] | None:
    """Write one historical attendance row. Returns None, or a row-level error.

    Each row commits independently, like the student importer: §9's journey is a
    migration, and one bad line in ten thousand must not abort the batch — the
    caller re-imports the failed rows from the error report.

    **This path deliberately does not apply three rules the register does**, and
    each omission is the point of having a separate path rather than reusing
    `bulk_mark_student_attendance`:

    1. **No calendar gate.** The tenant's *current* working week and holiday list
       describe this year. A register migrated from three years ago was kept
       against that year's calendar, and refusing rows against today's would
       reject legitimate history — silently rewriting what a school's own records
       say happened.
    2. **No lock-window check.** Every imported row is historical by
       construction, so the window has passed for all of them; enforcing it would
       reject the entire file.
    3. **No guardian alerts.** This is the most important of the three. Importing
       a year of history must not email a parent about an absence from last March.
       Writing rows directly is what guarantees that, rather than a flag on the
       marking path that a later caller could forget to set.

    Imported rows land **locked** (`is_locked=True`) and `source=import`: a
    migrated register is not something a teacher edits at the register, and a
    correction is the right way to change one. `AttendanceSource.IMPORT` was
    declared and unreachable until now.
    """
    from apps.student_management.models import Student

    missing = [column for column in REQUIRED_IMPORT_COLUMNS if not row.get(column)]
    if missing:
        return {"row": str(row_number), "field": missing[0], "issue": "This column is required."}

    status_value = (row["status"] or "").strip().lower()
    if status_value not in AttendanceStatus.values:
        return {
            "row": str(row_number),
            "field": "status",
            "issue": f"'{row['status']}' is not one of: {', '.join(AttendanceStatus.values)}.",
        }
    if status_value in SYSTEM_ONLY_STATUSES:
        # The same rule the register and the correction flow enforce: `on_leave`
        # means an approved leave request exists, and an import has none to point
        # at. A migrated leave day is imported as `excused`.
        return {
            "row": str(row_number),
            "field": "status",
            "issue": "'on_leave' needs a leave request; import a migrated leave day as 'excused'.",
        }

    try:
        on_date = datetime.date.fromisoformat(row["attendance_date"].strip())
    except ValueError:
        return {
            "row": str(row_number),
            "field": "attendance_date",
            "issue": f"'{row['attendance_date']}' is not an ISO date (YYYY-MM-DD).",
        }
    if on_date > timezone.localdate():
        return {
            "row": str(row_number),
            "field": "attendance_date",
            "issue": "A historical import cannot carry a future date.",
        }

    check_in, error = _parse_import_time(row.get("check_in_time"), "check_in_time", row_number)
    if error:
        return error
    check_out, error = _parse_import_time(row.get("check_out_time"), "check_out_time", row_number)
    if error:
        return error

    student = (
        Student.objects.alive().filter(admission_number=row["admission_number"].strip()).first()
    )
    if student is None:
        return {
            "row": str(row_number),
            "field": "admission_number",
            "issue": "No live student has this admission number.",
        }

    # **Any** enrollment status, deliberately — not just ACTIVE. A historical
    # register is imported for a session that has usually ended, so the students
    # in it are legitimately `completed`, `transferred` or `withdrawn` by now.
    # Narrowing this to ACTIVE would reject exactly the rows a backfill exists to
    # carry. The most recent enrollment is the one the register was kept against.
    enrollment = (
        StudentEnrollment.objects.alive()
        .filter(student=student, academic_session=session)
        .order_by("-enrollment_date")
        .first()
    )
    if enrollment is None:
        return {
            "row": str(row_number),
            "field": "admission_number",
            "issue": "This student has no enrollment in the named session.",
        }

    # The import upserts, so it can land on a row a human has already settled.
    # Neither of these may be overwritten, for the same reasons the register
    # refuses them: a locked row is one the correction workflow owns, and an
    # `on_leave` row belongs to an approved leave request that would be left
    # pointing at a status it no longer describes. A migration silently
    # rewriting either is worse than a row in the error report — the whole point
    # of the report is that the operator re-imports what genuinely failed.
    existing = (
        StudentAttendance.objects.alive()
        .filter(student=student, attendance_date=on_date, period__isnull=True)
        .first()
    )
    if existing is not None and existing.status == AttendanceStatus.ON_LEAVE:
        return {
            "row": str(row_number),
            "field": "attendance_date",
            "issue": "This student has approved leave on this date; cancel it before importing.",
        }
    if (
        existing is not None
        and existing.source != AttendanceSource.IMPORT
        and (existing.is_locked or is_locked(existing.attendance_date))
    ):
        # Locked *and not this path's own work*. The source is the discriminator,
        # and it has to be: the import writes its own rows locked by design, so a
        # bare locked-row refusal blocks the re-run §9's journey depends on —
        # "reviews the row-level error report … re-imports failed rows only".
        # A row a *person* marked or corrected is `manual`; one the leave module
        # wrote is `system`. Those are the ones a migration must not rewrite.
        return {
            "row": str(row_number),
            "field": "attendance_date",
            "issue": (
                "A locked record already exists for this date; change it through a "
                "correction request rather than a re-import."
            ),
        }

    late = (
        calendar.late_minutes(check_in, campus_id=student.campus_id)
        if status_value == AttendanceStatus.LATE and check_in is not None
        else None
    )

    try:
        with transaction.atomic():
            StudentAttendance.objects.update_or_create(
                student=student,
                attendance_date=on_date,
                period=None,
                defaults={
                    "tenant_id": tenant_id,
                    "section": enrollment.section,
                    "academic_session": session,
                    "status": status_value,
                    "check_in_time": check_in,
                    "check_out_time": check_out,
                    "late_minutes": late,
                    "remarks": (row.get("remarks") or "").strip() or None,
                    "source": AttendanceSource.IMPORT,
                    "marked_by": actor_id,
                    "is_locked": True,
                    "created_by": actor_id,
                    "updated_by": actor_id,
                },
            )
    except IntegrityError as exc:
        # The message carries the constraint name, so a genuine duplicate reads
        # as one and anything else says what it actually was. A bare "duplicate
        # record" for every IntegrityError sends the operator looking for a
        # conflict that is not there.
        detail = str(exc).strip().splitlines()[0]
        return {
            "row": str(row_number),
            "field": "attendance_date",
            "issue": f"This row could not be written: {detail}",
        }
    return None


def _parse_import_time(
    raw: str | None, field: str, row_number: int
) -> tuple[datetime.time | None, dict[str, str] | None]:
    value = (raw or "").strip()
    if not value:
        return None, None
    try:
        return datetime.time.fromisoformat(value), None
    except ValueError:
        return None, {
            "row": str(row_number),
            "field": field,
            "issue": f"'{value}' is not a time (HH:MM or HH:MM:SS).",
        }
