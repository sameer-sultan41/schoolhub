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
import uuid
from typing import TYPE_CHECKING

from django.db import transaction
from django.utils import timezone

from apps.attendance.models import (
    AttendanceCorrection,
    AttendanceSource,
    AttendanceStatus,
    CorrectionStatus,
    StudentAttendance,
)
from apps.school_organization import calendar
from apps.school_organization.services import assert_session_writable
from apps.student_management.models import EnrollmentStatus, Student, StudentEnrollment
from core.api.exceptions import Conflict, DomainRuleViolation
from core.rbac.models import RecordScope
from core.rbac.permissions import user_scopes
from core.tenancy.models import TenantSettings

if TYPE_CHECKING:
    from apps.school_organization.models import AcademicSession, Section
    from apps.timetable.models import Period

# §19: "lock window: end of marking day (recommendation; tenant-configurable
# 0-7 days)". Zero means "locks tonight", which is the recommended default.
DEFAULT_LOCK_WINDOW_DAYS = 0
MAX_LOCK_WINDOW_DAYS = 7

# The statuses that make a guardian alert appropriate (§12's first two rows).
ALERT_STATUSES = frozenset({AttendanceStatus.ABSENT, AttendanceStatus.LATE})

# Written by the leave module on approval, never by a teacher at the register:
# a status that means "there is an approved leave request" must not be settable
# without one, or the `leave_request_id` back-link would be a lie.
SYSTEM_ONLY_STATUSES = frozenset({AttendanceStatus.ON_LEAVE})


# ---------------------------------------------------------------------------
# The calendar and the lock window
# ---------------------------------------------------------------------------


def lock_window_days() -> int:
    """How long a marked row stays editable in place, in days.

    Read from ``tenant_settings.academic.attendance_lock_window_days`` and
    clamped to §19's stated 0-7 range rather than trusted: this decides whether a
    register can still be edited, and a tenant that stores 3650 has effectively
    turned the correction workflow off without anyone deciding to.
    """
    row = TenantSettings.objects.first()
    academic = row.academic if row is not None and isinstance(row.academic, dict) else {}
    configured = academic.get("attendance_lock_window_days")
    if not isinstance(configured, int) or isinstance(configured, bool):
        return DEFAULT_LOCK_WINDOW_DAYS
    return max(0, min(configured, MAX_LOCK_WINDOW_DAYS))


def is_locked(attendance_date: datetime.date, *, today: datetime.date | None = None) -> bool:
    """§5.5 — a row past the lock window is edited only through a correction.

    Computed from the date rather than read from the ``is_locked`` column so the
    answer is right the moment the window passes. The column is the *persisted*
    view of the same thing, swept nightly, and exists so a client can render the
    state without recomputing it per row.
    """
    today = today or timezone.localdate()
    return attendance_date < today - datetime.timedelta(days=lock_window_days())


def assert_markable_date(*, on_date: datetime.date, campus_id: uuid.UUID | None) -> None:
    """§11 — not in the future, not a weekend, not a holiday.

    The holiday case names the holiday. A teacher told only "this date cannot be
    marked" retries; one told "this is Founders Day" stops.
    """
    today = timezone.localdate()
    if on_date > today:
        raise DomainRuleViolation(
            {"attendance_date": "Attendance records what happened; it cannot be marked ahead."}
        )

    holiday = calendar.holiday_name(on_date, campus_id=campus_id)
    if holiday is not None:
        raise DomainRuleViolation(
            {"attendance_date": f"{on_date} is {holiday}; the school is closed."}
        )
    if not calendar.is_working_day(on_date, campus_id=campus_id):
        raise DomainRuleViolation(
            {"attendance_date": f"{on_date} is not a working day for this school."}
        )


def assert_marker_may_mark_section(*, user, section: Section) -> None:
    """§11 — the marker must hold `assigned` scope for the section unless `all`.

    Checked here rather than left to ``scope_queryset`` because marking is a
    *write* to a section the caller names in the body, not a read of a list the
    scope narrowed. A section a caller cannot reach is a 404, never a 403
    (AGENTS.md invariant 2), and that 404 is raised by the view resolving the
    section through the scoped queryset — this function covers the remaining
    case, where the scope is `assigned` and the section resolves but is not
    theirs to mark.
    """
    scopes = user_scopes(user)
    if RecordScope.ALL in scopes or RecordScope.CAMPUS in scopes:
        return
    if RecordScope.ASSIGNED not in scopes:
        # `own` alone cannot mark anything: a student marking their own register
        # is not a workflow §5 describes.
        raise DomainRuleViolation({"section_id": "You are not assigned to mark this section."})

    from apps.staff_management.models import EmploymentStatus, Staff

    is_class_teacher = (
        Staff.objects.alive()
        .filter(
            user_id=user.pk,
            employment_status=EmploymentStatus.ACTIVE,
            pk=section.class_teacher_staff_id,
        )
        .exists()
    )
    if not is_class_teacher:
        raise DomainRuleViolation({"section_id": "You are not assigned to mark this section."})


# ---------------------------------------------------------------------------
# The roster
# ---------------------------------------------------------------------------


def section_roster(*, section: Section, session: AcademicSession) -> list[Student]:
    """The students a register covers — §6's "roster auto-loaded from enrollments".

    Ordered by roll number then name so the register renders in the order a
    teacher reads a class list, with unnumbered students last rather than first.
    """
    enrollments = (
        StudentEnrollment.objects.alive()
        .filter(section=section, academic_session=session, status=EnrollmentStatus.ACTIVE)
        .select_related("student")
        .order_by("roll_number", "student__first_name", "student__last_name")
    )
    return [
        enrollment.student for enrollment in enrollments if enrollment.student.deleted_at is None
    ]


def _enrolled_student_ids(*, section: Section, session: AcademicSession) -> set[uuid.UUID]:
    return set(
        StudentEnrollment.objects.alive()
        .filter(section=section, academic_session=session, status=EnrollmentStatus.ACTIVE)
        .values_list("student_id", flat=True)
    )


# ---------------------------------------------------------------------------
# Marking
# ---------------------------------------------------------------------------


def _resolve_times(
    entry: dict, *, campus_id: uuid.UUID | None
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
    return check_in, calendar.late_minutes(check_in, campus_id=campus_id)


@transaction.atomic
def bulk_mark_student_attendance(
    *,
    section: Section,
    session: AcademicSession,
    on_date: datetime.date,
    period: Period | None,
    entries: list[dict],
    actor_id: uuid.UUID,
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
    """
    assert_session_writable(session)
    assert_markable_date(on_date=on_date, campus_id=section.campus_id)

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

    existing = {
        row.student_id: row
        for row in StudentAttendance.objects.alive()
        .filter(student_id__in=seen, attendance_date=on_date, period=period)
        .select_for_update()
    }

    locked = [
        str(student_id)
        for student_id, row in existing.items()
        if row.is_locked or is_locked(row.attendance_date)
    ]
    if locked:
        raise Conflict(
            "Some of these records are locked and must be changed through a correction request.",
        )

    created: list[StudentAttendance] = []
    updated: list[StudentAttendance] = []

    for entry in entries:
        check_in, late = _resolve_times(entry, campus_id=section.campus_id)
        row = existing.get(entry["student_id"])
        if row is None:
            created.append(
                StudentAttendance(
                    tenant_id=section.tenant_id,
                    student_id=entry["student_id"],
                    section=section,
                    academic_session=session,
                    period=period,
                    attendance_date=on_date,
                    status=entry["status"],
                    check_in_time=check_in,
                    check_out_time=entry.get("check_out_time"),
                    late_minutes=late,
                    remarks=entry.get("remarks"),
                    source=AttendanceSource.MANUAL,
                    marked_by=actor_id,
                    created_by=actor_id,
                    updated_by=actor_id,
                )
            )
        else:
            row.status = entry["status"]
            row.check_in_time = check_in
            row.check_out_time = entry.get("check_out_time")
            row.late_minutes = late
            row.remarks = entry.get("remarks")
            row.marked_by = actor_id
            row.updated_by = actor_id
            updated.append(row)

    if created:
        StudentAttendance.objects.bulk_create(created)
    if updated:
        StudentAttendance.objects.bulk_update(
            updated,
            [
                "status",
                "check_in_time",
                "check_out_time",
                "late_minutes",
                "remarks",
                "marked_by",
                "updated_by",
                "updated_at",
            ],
        )

    rows = [*created, *updated]
    alerts = [row for row in rows if row.status in ALERT_STATUSES]
    return {
        "marked": len(created),
        "updated": len(updated),
        "rows": rows,
        "alerts": alerts,
    }


# ---------------------------------------------------------------------------
# Corrections
# ---------------------------------------------------------------------------

CORRECTABLE_FIELDS = ("status", "check_in_time", "check_out_time", "remarks")


def request_correction(
    *, target: StudentAttendance, new_values: dict, reason: str, actor_id: uuid.UUID
) -> AttendanceCorrection:
    """§5.5 — a locked row is changed only through an approved correction.

    Refuses an *unlocked* row deliberately: while a row is still editable the
    teacher can simply re-mark it, and a correction raised against it would sit
    in an approver's queue asking them to authorise something the requester
    could already do.
    """
    if not (target.is_locked or is_locked(target.attendance_date)):
        raise DomainRuleViolation(
            {
                "student_attendance_id": (
                    "This record is still within the marking window; edit the register instead."
                )
            }
        )

    proposed = {field: new_values[field] for field in CORRECTABLE_FIELDS if field in new_values}
    if not proposed:
        raise DomainRuleViolation(
            {"new_values": f"Name at least one of: {', '.join(CORRECTABLE_FIELDS)}."}
        )

    old = {field: getattr(target, field) for field in proposed}
    if all(old[field] == proposed[field] for field in proposed):
        raise DomainRuleViolation({"new_values": "The proposed values match the record (§11)."})

    return AttendanceCorrection.objects.create(
        tenant_id=target.tenant_id,
        subject_type="student",
        student_attendance=target,
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
    """§11 — approver ≠ requester. Segregation of duties (auth-and-rbac §2.4).

    Checked here rather than in the viewset because the rule is the module's, not
    HTTP's: the same check has to hold when hr-leave later approves through its
    own endpoint, and when a bulk approval screen calls this in a loop.

    An approved correction applies ``new_values`` to the target **and the
    correction row stays**: §6 makes the row itself the audit trail, so it is
    never deleted and never rewritten.
    """
    if correction.status != CorrectionStatus.PENDING:
        raise Conflict(f"This correction was already {correction.status}.")
    if correction.requested_by == reviewer_id:
        raise DomainRuleViolation(
            {"reviewed_by": "An approver cannot decide their own correction request (§11)."}
        )

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
        target = StudentAttendance.objects.select_for_update().get(
            pk=correction.student_attendance_id
        )
        for field, value in correction.new_values.items():
            setattr(target, field, _from_json(field, value))
        target.updated_by = reviewer_id
        target.save(update_fields=[*correction.new_values, "updated_by", "updated_at"])

    return correction


def _to_json(values: dict) -> dict:
    """JSONB cannot hold a `time`; store the ISO string it round-trips through."""
    return {
        field: value.isoformat() if isinstance(value, datetime.time) else value
        for field, value in values.items()
    }


def _from_json(field: str, value):
    if field in ("check_in_time", "check_out_time") and isinstance(value, str):
        return datetime.time.fromisoformat(value)
    return value
