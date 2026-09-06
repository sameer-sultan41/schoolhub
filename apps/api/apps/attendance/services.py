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
from typing import TYPE_CHECKING

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.attendance import uploads
from apps.attendance.models import (
    ApprovalDecision,
    AttendanceCorrection,
    AttendanceSource,
    AttendanceStatus,
    CorrectionStatus,
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
from core.api.exceptions import Conflict, DomainRuleViolation
from core.rbac.models import RecordScope
from core.rbac.permissions import user_scopes
from core.tenancy.models import TenantSettings

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from apps.school_organization.models import Section
    from apps.staff_management.models import Staff
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
    on_leave = [
        {
            "student_id": str(student_id),
            "issue": (
                "This student has approved leave on this date; cancel the leave "
                "request before marking them."
            ),
        }
        for student_id, row in existing.items()
        if row.status == AttendanceStatus.ON_LEAVE
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


def _leave_config() -> dict:
    row = TenantSettings.objects.first()
    academic = row.academic if row is not None and isinstance(row.academic, dict) else {}
    config = academic.get("student_leave_approval")
    return config if isinstance(config, dict) else {}


def escalation_threshold_days() -> int:
    """Above this many days, a student leave request needs a second approval.

    Tenant-configurable per multi-tenancy §5 — the approval chain is
    configuration, not a constant — but read defensively: zero would escalate
    every single-day absence and make the second approver's queue useless, so it
    is floored at one.
    """
    configured = _leave_config().get("escalation_threshold_days")
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
    row.early_departure_minutes = calendar.early_departure_minutes(
        check_out_time, campus_id=_staff_campus_id(row.staff)
    )
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


def assert_report_range(*, start_date: datetime.date, end_date: datetime.date) -> None:
    if end_date < start_date:
        raise DomainRuleViolation({"end_date": "The range ends before it starts."})
