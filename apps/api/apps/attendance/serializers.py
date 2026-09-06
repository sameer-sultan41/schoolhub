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

from rest_framework import serializers

from apps.attendance import services
from apps.attendance.models import (
    AttendanceCorrection,
    AttendanceStatus,
    LeaveApproval,
    LeaveRequest,
    LeaveType,
    StudentAttendance,
)
from apps.school_organization.models import AcademicSession, Section
from apps.student_management.models import Student
from apps.timetable.models import Period
from core.files.models import File

READ_ONLY_FIELDS = ("id", "created_at", "updated_at")


def _fk(model, **kwargs) -> serializers.PrimaryKeyRelatedField:
    """A related field bound to the model's *tenant-scoped* manager.

    ``model.objects``, never ``.all()``: the manager is what narrows the lookup
    to the caller's tenant, so a smuggled foreign id simply does not resolve.
    """
    return serializers.PrimaryKeyRelatedField(queryset=model.objects, **kwargs)


class StudentAttendanceSerializer(serializers.ModelSerializer):
    """`student_attendance` — read shape. Rows are written by `:bulk-mark`."""

    student_id = _fk(Student, source="student", read_only=False)
    section_id = _fk(Section, source="section")
    academic_session_id = _fk(AcademicSession, source="academic_session")
    period_id = _fk(Period, source="period", allow_null=True, required=False)
    leave_request_id = serializers.PrimaryKeyRelatedField(source="leave_request", read_only=True)
    is_locked = serializers.SerializerMethodField()

    class Meta:
        model = StudentAttendance
        fields = (
            "id",
            "student_id",
            "section_id",
            "academic_session_id",
            "period_id",
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
        return bool(row.is_locked or services.is_locked(row.attendance_date))


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
    carry its id around. `period_id` omitted means daily mode, which is §19's
    recommended default.
    """

    section_id = _fk(Section, source="section")
    academic_session_id = _fk(AcademicSession, source="academic_session", required=False)
    period_id = _fk(Period, source="period", required=False, allow_null=True)
    attendance_date = serializers.DateField()
    entries = serializers.ListField(child=BulkMarkEntrySerializer(), allow_empty=False)


class AttendanceCorrectionSerializer(serializers.ModelSerializer):
    """`attendance_corrections` — the request half. Decisions are colon-actions."""

    student_attendance_id = _fk(StudentAttendance, source="student_attendance")

    class Meta:
        model = AttendanceCorrection
        fields = (
            "id",
            "subject_type",
            "student_attendance_id",
            "requested_by",
            "old_values",
            "new_values",
            "reason",
            "status",
            "reviewed_by",
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


class LeaveApprovalSerializer(serializers.ModelSerializer):
    """One step of §7.2's chain, nested on the request it belongs to."""

    class Meta:
        model = LeaveApproval
        fields = (
            "id",
            "level",
            "required_permission",
            "approver_id",
            "decision",
            "decided_at",
            "note",
        )
        read_only_fields = fields


class LeaveRequestSerializer(serializers.ModelSerializer):
    """`leave_requests` — the student half (§16).

    `days_count` is read-only because §11 computes it net of holidays, and
    `status`/`current_approval_level`/`decided_at` because they move only through
    the colon-actions. A writable `days_count` would let a client understate a
    fortnight to duck the escalation threshold.

    The chain is nested rather than fetched separately: a requester's first
    question is "how many people have to say yes", and §16 declares no
    `/leave-requests/{id}/approvals` sub-resource to ask it with.
    """

    student_id = _fk(Student, source="student")
    leave_type_id = _fk(LeaveType, source="leave_type")
    attachment_file_id = _fk(File, source="attachment_file", required=False, allow_null=True)
    approvals = LeaveApprovalSerializer(many=True, read_only=True)

    class Meta:
        model = LeaveRequest
        fields = (
            "id",
            "requester_type",
            "student_id",
            "submitted_by",
            "leave_type_id",
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


class LeaveDecisionSerializer(serializers.Serializer):
    """Body for `:approve` / `:reject` — an optional note, nothing else.

    The decision is the route rather than a field, for the reason
    `CorrectionDecisionSerializer` gives: one endpoint taking `{"approve": bool}`
    could not be permission-gated differently for the two outcomes.
    """

    note = serializers.CharField(max_length=500, required=False, allow_null=True)
