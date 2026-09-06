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

from django.db import IntegrityError, transaction
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
    """The student ids a register submission may legitimately name.

    `student__deleted_at__isnull=True` is not redundant with `.alive()`: that
    narrows the *enrollment*, and a soft-deleted student can still hold a live
    enrollment row — nothing cascades the flag. Without it a deleted student
    stayed markable, which `section_roster` already excluded, so the roster a
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
        check_in, late = _resolve_times(entry, campus_id=section.campus_id)
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
    # marks queues nothing.
    alerts = [row for row in transitioned if row.status in ALERT_STATUSES]
    if alerts:
        _queue_alerts(tenant_id=section.tenant_id, rows=alerts)

    return {
        "marked": len(created),
        "updated": len(updated),
        "rows": rows,
        "alerts": alerts,
    }


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
        raise DomainRuleViolation(
            {"new_values": f"Name at least one of: {', '.join(CORRECTABLE_FIELDS)}."}
        )

    # Compared *after* normalisation, not before. The serializer stores times as
    # ISO strings (so `_from_json` reads back exactly what a TimeField wrote),
    # while `getattr` returns `datetime.time` — so a raw comparison of those two
    # fields was never equal and the "values must differ" rule silently never
    # fired for a time-only correction.
    old = {field: getattr(target, field) for field in proposed}
    if _to_json(old) == _to_json(proposed):
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

    **The correction row is locked before its status is read.** Only the target
    attendance row was locked before, which left the decision itself racy: two
    reviewers deciding the same correction in the same window both passed the
    PENDING check, and the later commit won — so a correction could persist as
    `rejected` after a concurrent `:approve` had already mutated the attendance
    row and recomputed `late_minutes`. That is exactly the audit-trail guarantee
    §6 asks this row to carry, so the lock belongs on the row that carries it.
    """
    correction = (
        AttendanceCorrection.objects.select_for_update()
        .select_related("student_attendance")
        .get(pk=correction.pk)
    )
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
        _apply_correction(correction=correction, reviewer_id=reviewer_id)

    return correction


def _apply_correction(*, correction: AttendanceCorrection, reviewer_id: uuid.UUID) -> None:
    """Write an approved correction onto its target row.

    **`late_minutes` is recomputed, not carried over.** It is not a correctable
    field — §11 computes it server-side — so a correction that changes `status`
    to `late` or moves `check_in_time` left the old value in place: a row
    corrected from absent to late reported zero minutes late, and §13's
    punctuality report summed those zeros. Recomputing here is the same call the
    register makes, so both write paths agree.
    """
    target = StudentAttendance.objects.select_for_update().get(pk=correction.student_attendance_id)
    for field, value in correction.new_values.items():
        setattr(target, field, _from_json(field, value))

    target.late_minutes = (
        calendar.late_minutes(target.check_in_time, campus_id=target.section.campus_id)
        if target.status == AttendanceStatus.LATE and target.check_in_time is not None
        else None
    )
    target.updated_by = reviewer_id
    target.save(update_fields=[*correction.new_values, "late_minutes", "updated_by", "updated_at"])


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
