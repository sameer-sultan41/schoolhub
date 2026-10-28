"""Serializers for the attendance module.

Shape follows timetable/serializers.py: foreign keys are exposed with an `_id`
suffix over the tenant-scoped default manager (so a foreign-tenant id fails to
resolve and yields a 400 rather than leaking whether the row exists), explicit
`fields` tuples, and anything the server decides is read-only.

**What is read-only here is the module's whole integrity story.** §11 says
`late_minutes` is computed server-side and never client-supplied; `is_locked` is
the lock window's answer, not the caller's claim; `marked_by` is the
authenticated actor. A writable version of any of the three lets a client decide
something §13's reports and §5.5's correction gate depend on.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.db import models
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.attendance import services
from apps.attendance.models import (
    AttendanceCorrection,
    AttendanceStatus,
    LeaveApproval,
    LeaveRequest,
    LeaveType,
    StaffAttendance,
    StudentAttendance,
)
from apps.school_organization.models import AcademicSession, Section
from apps.staff_management.models import Staff
from apps.student_management.models import Student
from apps.timetable.models import Period
from core.exports import tabular
from core.files.models import File
from core.rbac.models import User

if TYPE_CHECKING:
    import uuid
    from collections.abc import Iterable

READ_ONLY_FIELDS = ("id", "created_at", "updated_at")

# The serializer context key that carries one response's `users(id) -> name` map.
USER_NAMES_CONTEXT_KEY = "attendance_user_names"


def _load_user_names(context: dict, user_ids: Iterable[uuid.UUID | None]) -> dict:
    """Names for every id not loaded yet, in one query, kept in the root's context.

    `requested_by`, `submitted_by` and `approver_id` are plain `users(id)` columns,
    not foreign keys, so there is nothing to `select_related`. An unknown id maps to
    None and is not asked for again. So does a nameless user: `get_full_name` would
    fall back to their email, which a co-guardian or a parent must not see.
    """
    names = context.setdefault(USER_NAMES_CONTEXT_KEY, {})
    missing = {user_id for user_id in user_ids if user_id is not None and user_id not in names}
    if missing:
        users = User.objects.filter(pk__in=missing).only("id", "first_name", "last_name")
        names.update(
            {user.pk: f"{user.first_name} {user.last_name}".strip() or None for user in users}
        )
        names.update({user_id: None for user_id in missing if user_id not in names})
    return names


class UserNamesListSerializer(serializers.ListSerializer):
    """Loads every row's user names in one query before the rows render."""

    def to_representation(self, data):
        rows = list(data.all() if isinstance(data, models.manager.BaseManager) else data)
        _load_user_names(self.context, (uid for row in rows for uid in self.child.user_ids(row)))
        return super().to_representation(rows)


class UserNamesModelSerializer(serializers.ModelSerializer):
    """`*_name` fields for `users(id)` columns: first and last name, never the email.

    A subclass lists its ids in `user_ids` and sets `UserNamesListSerializer` as its
    `Meta.list_serializer_class`, so a page costs one user query, not one per row.
    """

    def user_ids(self, instance) -> Iterable[uuid.UUID | None]:
        raise NotImplementedError

    def user_name(self, user_id: uuid.UUID | None) -> str | None:
        return _load_user_names(self.context, [user_id]).get(user_id) if user_id else None

    def to_representation(self, instance):
        _load_user_names(self.context, self.user_ids(instance))
        return super().to_representation(instance)


def _fk(model, **kwargs) -> serializers.PrimaryKeyRelatedField:
    """A related field bound to the model's *tenant-scoped* manager.

    ``model.objects``, never ``.all()``: the manager is what narrows the lookup
    to the caller's tenant, so a smuggled foreign id simply does not resolve.
    """
    return serializers.PrimaryKeyRelatedField(queryset=model.objects, **kwargs)


# The serializer context key that carries the lock window across one response's rows.
LOCK_WINDOW_CONTEXT_KEY = "attendance_lock_window_days"


class StudentAttendanceSerializer(serializers.ModelSerializer):
    """`student_attendance` — read shape. Rows are written by `:bulk-mark`."""

    # The names are read-only; every caller loads the relations up front, so they
    # cost no query per row.
    student_id = _fk(Student, source="student", read_only=False)
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    admission_number = serializers.CharField(source="student.admission_number", read_only=True)
    section_id = _fk(Section, source="section")
    section_name = serializers.CharField(source="section.name", read_only=True)
    academic_session_id = _fk(AcademicSession, source="academic_session")
    period_id = _fk(Period, source="period", allow_null=True, required=False)
    period_name = serializers.CharField(source="period.name", read_only=True, allow_null=True)
    leave_request_id = serializers.PrimaryKeyRelatedField(
        source="leave_request", read_only=True, allow_null=True
    )
    is_locked = serializers.SerializerMethodField()

    class Meta:
        model = StudentAttendance
        fields = (
            "id",
            "student_id",
            "student_name",
            "admission_number",
            "section_id",
            "section_name",
            "academic_session_id",
            "period_id",
            "period_name",
            "attendance_date",
            "status",
            "check_in_time",
            "check_out_time",
            "late_minutes",
            "leave_request_id",
            "source",
            "marked_by",
            "is_locked",
            "remarks",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            *READ_ONLY_FIELDS,
            # Each of these is the server's answer, not the client's claim —
            # see the module docstring.
            "late_minutes",
            "leave_request_id",
            "source",
            "marked_by",
            "is_locked",
        )

    def get_is_locked(self, row: StudentAttendance) -> bool:
        """The *effective* lock state, not the persisted column.

        `is_locked` is swept nightly, so between the window passing and the sweep
        running the column says False while every write path answers 409 — the
        service checks `row.is_locked or is_locked(row.attendance_date)`. A client
        rendering the column alone offered an edit that could not succeed. Same
        expression, one source.
        """
        # Read once per response and kept in the root's context, or every row
        # would re-read the tenant's settings.
        window = self.context.get(LOCK_WINDOW_CONTEXT_KEY)
        if window is None:
            window = services.lock_window_days()
            self.context[LOCK_WINDOW_CONTEXT_KEY] = window
        return bool(row.is_locked or services.is_locked(row.attendance_date, window_days=window))


class BulkMarkEntrySerializer(serializers.Serializer):
    """One student's row in a submitted register.

    `late_minutes` is deliberately **absent** rather than read-only: a client
    sending it should not have it silently accepted-and-ignored under a name it
    recognises. §11 computes it, and `services._resolve_times` is where.
    """

    student_id = serializers.UUIDField()
    status = serializers.ChoiceField(choices=AttendanceStatus.choices)
    check_in_time = serializers.TimeField(required=False, allow_null=True)
    check_out_time = serializers.TimeField(required=False, allow_null=True)
    remarks = serializers.CharField(max_length=255, required=False, allow_null=True)

    def validate(self, attrs: dict) -> dict:
        check_in, check_out = attrs.get("check_in_time"), attrs.get("check_out_time")
        if check_in and check_out and check_out <= check_in:
            raise serializers.ValidationError(
                {"check_out_time": "A student cannot leave before they arrived."}
            )
        return attrs


class BulkMarkSerializer(serializers.Serializer):
    """`POST /student-attendance:bulk-mark` — one section, one date, one period.

    `academic_session_id` is optional and falls back to the tenant's current
    session: a school runs one at a time and the register UI has no reason to
    carry its id around. `period_id` is required in period mode and refused in
    daily mode (ADR-0028); it is a plain UUID so an unknown or foreign period is
    the view's 404, like the register's.
    """

    section_id = _fk(Section, source="section")
    academic_session_id = _fk(AcademicSession, source="academic_session", required=False)
    period_id = serializers.UUIDField(required=False, allow_null=True)
    attendance_date = serializers.DateField()
    entries = serializers.ListField(child=BulkMarkEntrySerializer(), allow_empty=False)


class RegisterQuerySerializer(serializers.Serializer):
    """Query parameters of `GET /student-attendance/register`.

    `section_id` and `period_id` are plain UUIDs rather than related fields so an
    unknown or foreign id is the view's 404, not a 400 (AGENTS.md invariant 2).
    """

    section_id = serializers.UUIDField()
    date = serializers.DateField()
    period_id = serializers.UUIDField(required=False, allow_null=True)


class RegisterEntrySerializer(serializers.Serializer):
    """One rostered student on a register, with the record for that date if marked."""

    student_id = serializers.UUIDField(source="student.pk", read_only=True)
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    admission_number = serializers.CharField(source="student.admission_number", read_only=True)
    roll_number = serializers.CharField(read_only=True, allow_null=True)
    record = StudentAttendanceSerializer(read_only=True, allow_null=True)
    on_leave = serializers.BooleanField(
        read_only=True, help_text="The student has a daily `on_leave` row for this date."
    )


class MyRegistersQuerySerializer(serializers.Serializer):
    """Query parameters of `GET /student-attendance/my-registers`."""

    date = serializers.DateField(required=False, help_text="Defaults to today.")


class MyRegisterSerializer(serializers.Serializer):
    """One register the caller marks on a date. The period fields are null in daily mode."""

    section_id = serializers.UUIDField(read_only=True)
    section_name = serializers.CharField(read_only=True)
    class_name = serializers.CharField(read_only=True)
    campus_id = serializers.UUIDField(read_only=True)
    period_id = serializers.UUIDField(read_only=True, allow_null=True)
    period_name = serializers.CharField(read_only=True, allow_null=True)
    start_time = serializers.TimeField(read_only=True, allow_null=True)
    end_time = serializers.TimeField(read_only=True, allow_null=True)
    marked_count = serializers.IntegerField(read_only=True)
    roster_count = serializers.IntegerField(read_only=True)


class AttendanceCorrectionSerializer(UserNamesModelSerializer):
    """`attendance_corrections` — the request half. Decisions are colon-actions.

    `student_attendance_id` is a plain UUID, not a related field: the view resolves
    it through the caller's scoped rows, so a row outside their scope (or another
    tenant's) is a 404, not a 400 (AGENTS.md invariant 2). The target's fields are
    read-only and null for a staff correction.
    """

    student_attendance_id = serializers.UUIDField()
    student_id = serializers.UUIDField(
        source="student_attendance.student_id", read_only=True, allow_null=True
    )
    student_name = serializers.CharField(
        source="student_attendance.student.full_name", read_only=True, allow_null=True
    )
    attendance_date = serializers.DateField(
        source="student_attendance.attendance_date", read_only=True, allow_null=True
    )
    period_name = serializers.CharField(
        source="student_attendance.period.name", read_only=True, allow_null=True
    )
    requested_by_name = serializers.SerializerMethodField()
    reviewed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = AttendanceCorrection
        list_serializer_class = UserNamesListSerializer
        fields = (
            "id",
            "subject_type",
            "student_attendance_id",
            "student_id",
            "student_name",
            "attendance_date",
            "period_name",
            "requested_by",
            "requested_by_name",
            "old_values",
            "new_values",
            "reason",
            "status",
            "reviewed_by",
            "reviewed_by_name",
            "reviewed_at",
            "review_note",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            *READ_ONLY_FIELDS,
            # `subject_type` is derived from which target was named, and
            # `old_values` is a snapshot the service takes — a client that could
            # write either could make the audit trail say whatever it liked.
            "subject_type",
            "old_values",
            "requested_by",
            "status",
            "reviewed_by",
            "reviewed_at",
            "review_note",
        )

    def user_ids(self, instance: AttendanceCorrection) -> list[uuid.UUID | None]:
        return [instance.requested_by, instance.reviewed_by]

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_requested_by_name(self, correction: AttendanceCorrection) -> str | None:
        return self.user_name(correction.requested_by)

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_reviewed_by_name(self, correction: AttendanceCorrection) -> str | None:
        return self.user_name(correction.reviewed_by)

    def validate_new_values(self, value: dict) -> dict:
        """Validate the proposal at the point it is *raised*, not when applied.

        These values sit in JSONB until an approver acts, which can be days
        later, so anything not checked here fails at `:approve` — far from the
        request that introduced it, and to a person who did not write it. That is
        how a malformed `check_in_time` became a 500 on approval.
        """
        if not isinstance(value, dict):
            raise serializers.ValidationError("Expected an object of field → new value.")
        unknown = set(value) - set(services.CORRECTABLE_FIELDS)
        if unknown:
            raise serializers.ValidationError(
                f"Not correctable: {', '.join(sorted(unknown))}. "
                f"Allowed: {', '.join(services.CORRECTABLE_FIELDS)}."
            )

        if "status" in value:
            if value["status"] not in AttendanceStatus.values:
                raise serializers.ValidationError({"status": "Not a known attendance status."})
            if value["status"] in services.SYSTEM_ONLY_STATUSES:
                raise serializers.ValidationError(
                    {
                        "status": (
                            "'on_leave' is set by an approved leave request, not by a correction."
                        )
                    }
                )

        # Round-tripped through the same field the register uses, so "what is a
        # valid time" is answered in one place. `to_internal_value` raises the
        # usual 400; storing the normalised ISO string keeps `_from_json` reading
        # exactly what a TimeField wrote.
        time_field = serializers.TimeField()
        for field in ("check_in_time", "check_out_time"):
            if value.get(field) is not None:
                value[field] = time_field.to_internal_value(value[field]).isoformat()

        return value


class CorrectionDecisionSerializer(serializers.Serializer):
    """Body for `:approve` / `:reject` — an optional note, nothing else.

    The decision itself is the route, not a field: a single endpoint taking
    `{"approve": bool}` would make the permission check unable to tell the two
    apart, and §4 grants them together only by coincidence.
    """

    review_note = serializers.CharField(max_length=500, required=False, allow_null=True)


class LeaveTypeSerializer(serializers.ModelSerializer):
    """`leave_types` — read-only here. See views.py for why writes are hr-leave's."""

    class Meta:
        model = LeaveType
        fields = (
            "id",
            "name",
            "code",
            "applies_to",
            "is_paid",
            "requires_attachment",
            "max_consecutive_days",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class LeaveApprovalSerializer(UserNamesModelSerializer):
    """One step of §7.2's chain, nested on the request it belongs to."""

    approver_name = serializers.SerializerMethodField()

    class Meta:
        model = LeaveApproval
        list_serializer_class = UserNamesListSerializer
        fields = (
            "id",
            "level",
            "required_permission",
            "approver_id",
            "approver_name",
            "decision",
            "decided_at",
            "note",
        )
        read_only_fields = fields

    def user_ids(self, instance: LeaveApproval) -> list[uuid.UUID | None]:
        return [instance.approver_id]

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_approver_name(self, step: LeaveApproval) -> str | None:
        return self.user_name(step.approver_id)


class LeaveRequestSerializer(UserNamesModelSerializer):
    """`leave_requests` — the student half (§16).

    `days_count` is read-only because §11 computes it net of holidays, and
    `status`/`current_approval_level`/`decided_at` because they move only through
    the colon-actions. A writable `days_count` would let a client understate a
    fortnight to duck the escalation threshold.

    The chain is nested rather than fetched separately: a requester's first
    question is "how many people have to say yes", and §16 declares no
    `/leave-requests/{id}/approvals` sub-resource to ask it with.

    `section_name` is the queryset's annotation (`LeaveRequest.with_section_name`):
    the student's ACTIVE enrollment in the current session, null when there is none.
    """

    student_id = _fk(Student, source="student")
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    admission_number = serializers.CharField(source="student.admission_number", read_only=True)
    section_name = serializers.CharField(read_only=True, allow_null=True)
    leave_type_id = _fk(LeaveType, source="leave_type")
    leave_type_name = serializers.CharField(source="leave_type.name", read_only=True)
    submitted_by_name = serializers.SerializerMethodField()
    attachment_file_id = _fk(File, source="attachment_file", required=False, allow_null=True)
    approvals = LeaveApprovalSerializer(many=True, read_only=True)

    class Meta:
        model = LeaveRequest
        list_serializer_class = UserNamesListSerializer
        fields = (
            "id",
            "requester_type",
            "student_id",
            "student_name",
            "admission_number",
            "section_name",
            "submitted_by",
            "submitted_by_name",
            "leave_type_id",
            "leave_type_name",
            "start_date",
            "end_date",
            "day_part",
            "days_count",
            "reason",
            "attachment_file_id",
            "status",
            "current_approval_level",
            "decided_at",
            "approvals",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            *READ_ONLY_FIELDS,
            "requester_type",
            "submitted_by",
            "days_count",
            "status",
            "current_approval_level",
            "decided_at",
        )

    def user_ids(self, instance: LeaveRequest) -> list[uuid.UUID | None]:
        # `.all()` reads the prefetched chain, so the steps' approvers load with the request's.
        return [instance.submitted_by, *(step.approver_id for step in instance.approvals.all())]

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_submitted_by_name(self, leave_request: LeaveRequest) -> str | None:
        return self.user_name(leave_request.submitted_by)


class LeaveDecisionSerializer(serializers.Serializer):
    """Body for `:approve` / `:reject` — an optional note, nothing else.

    The decision is the route rather than a field, for the reason
    `CorrectionDecisionSerializer` gives: one endpoint taking `{"approve": bool}`
    could not be permission-gated differently for the two outcomes.
    """

    note = serializers.CharField(max_length=500, required=False, allow_null=True)


class StaffAttendanceSerializer(serializers.ModelSerializer):
    """`staff_attendance` — §5.2.

    The three computed columns are read-only for the reason the student
    serializer's are: §11 computes them, and §13's punctuality report is a
    payroll input that is only worth reading if every row was measured the same
    way. `is_locked` is the effective lock, not the nightly-swept column — the
    same fix the student serializer carries.
    """

    staff_id = _fk(Staff, source="staff")
    is_locked = serializers.SerializerMethodField()

    class Meta:
        model = StaffAttendance
        fields = (
            "id",
            "staff_id",
            "attendance_date",
            "status",
            "check_in_time",
            "check_out_time",
            "late_minutes",
            "early_departure_minutes",
            "leave_request_id",
            "source",
            "marked_by",
            "is_locked",
            "remarks",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            *READ_ONLY_FIELDS,
            "late_minutes",
            "early_departure_minutes",
            "leave_request_id",
            "marked_by",
            "is_locked",
        )

    def get_is_locked(self, row: StaffAttendance) -> bool:
        return bool(row.is_locked or services.is_locked(row.attendance_date))

    def validate(self, attrs: dict) -> dict:
        check_in, check_out = attrs.get("check_in_time"), attrs.get("check_out_time")
        if check_in and check_out and check_out <= check_in:
            raise serializers.ValidationError(
                {"check_out_time": "Check-out must be later than check-in."}
            )
        return attrs


class StaffCheckOutSerializer(serializers.Serializer):
    """Body for `POST /staff-attendance/{id}:check-out` (§16)."""

    check_out_time = serializers.TimeField()


class AttendanceReportQuerySerializer(serializers.Serializer):
    """Query parameters for `GET /reports/attendance-summary` (§13, §16).

    One endpoint with a `kind`, not six routes: §16 declares exactly one report
    URL, and the six reports differ in their rows rather than in their shape —
    every one is a flat list under a date range and a record scope.
    """

    kind = serializers.ChoiceField(choices=[(k, k) for k in services.REPORT_KINDS])
    start_date = serializers.DateField()
    end_date = serializers.DateField(required=False)
    section_id = serializers.UUIDField(required=False, allow_null=True)
    period_id = serializers.UUIDField(
        required=False,
        allow_null=True,
        help_text="`daily-register` only: one period's own rows instead of the derived day.",
    )
    threshold = serializers.DecimalField(
        max_digits=4, decimal_places=1, required=False, min_value=0, max_value=100
    )
    # Only meaningful on the export (`POST`); a `GET` returns JSON rows. Declared
    # on the shared serializer rather than a second one because the six other
    # parameters are identical and duplicating them is how the two drift.
    format = serializers.ChoiceField(
        choices=[(key, key) for key in tabular.FORMATS], required=False, default="csv"
    )

    def validate(self, attrs: dict) -> dict:
        # A single-day report (the daily register) names one date; the rest take
        # a range. Defaulting `end_date` to `start_date` means the register does
        # not have to send the same date twice.
        attrs.setdefault("end_date", attrs["start_date"])
        services.assert_report_range(start_date=attrs["start_date"], end_date=attrs["end_date"])
        return attrs


class AttendanceSettingsSerializer(serializers.Serializer):
    """`GET /attendance-settings` — the effective values, defaults applied (§19)."""

    attendance_mode = serializers.ChoiceField(
        choices=[(mode, mode) for mode in services.ATTENDANCE_MODES], read_only=True
    )
    lock_window_days = serializers.IntegerField(read_only=True)
    leave_escalation_threshold_days = serializers.IntegerField(read_only=True)


class AttendanceSettingsUpdateSerializer(serializers.Serializer):
    """`PATCH /attendance-settings` — any subset of the three keys.

    Bounds are §19's: a lock window of 0-7 days, and an escalation threshold of
    at least one day (zero would escalate every single-day absence).
    """

    attendance_mode = serializers.ChoiceField(
        choices=[(mode, mode) for mode in services.ATTENDANCE_MODES], required=False
    )
    lock_window_days = serializers.IntegerField(
        required=False, min_value=0, max_value=services.MAX_LOCK_WINDOW_DAYS
    )
    leave_escalation_threshold_days = serializers.IntegerField(required=False, min_value=1)


class AttendanceImportRequestSerializer(serializers.Serializer):
    """`POST /student-attendance-imports` (multipart) — §9's onboarding migration.

    The file rides in the job's own payload rather than through `core.files`'
    two-step presigned flow, for the reason `StudentImportRequestSerializer`
    gives: that flow exists for binary media served back to users later, and an
    import file is read once into the job and never needs a signed URL.

    `academic_session_id` is required and not defaulted to the current session —
    unlike every other endpoint in this module. A historical register belongs to
    a *past* session by definition, so falling back to "current" would file three
    years of history under this year and be almost impossible to unpick.
    """

    file = serializers.FileField()
    academic_session_id = _fk(AcademicSession, source="academic_session")
