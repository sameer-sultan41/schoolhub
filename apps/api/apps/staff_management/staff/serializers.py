"""Serializers for `/staff` and its bulk import request (module doc §16).

Shape validation lives here; rules that need to look at other rows live in
``services`` and are invoked from the viewset (create) or ``validate_*``
(update), so the same rule applies whether the write arrives from the API or
the bulk importer — mirrors student_management/serializers.py exactly.

Foreign keys are exposed with their ``_id`` suffix to match the column names in
docs/05-database/entities/people.md and the filter names in the module doc §16.
"""

from __future__ import annotations

import uuid
from typing import Any

from rest_framework import serializers

from apps.school_organization.models import Campus, Department
from apps.staff_management.models import Designation, EmploymentStatus, Staff
from apps.staff_management.serializers import READ_ONLY_FIELDS, _fk
from apps.staff_management.staff.services.create import (
    assert_department_active,
    assert_designation_active,
    assert_employee_number_immutable,
    assert_national_id_available,
    assert_reports_to_acyclic,
    resolve_tenant_user_id,
)
from core.files.models import File


class StaffSerializer(serializers.ModelSerializer):
    campus_id = _fk(Campus, source="campus")
    department_id = _fk(Department, source="department", required=False, allow_null=True)
    designation_id = _fk(Designation, source="designation", required=False, allow_null=True)
    reports_to_staff_id = _fk(Staff, source="reports_to", required=False, allow_null=True)
    photo_file_id = _fk(File, source="photo_file", required=False, allow_null=True)
    # Explicitly optional, not read-only: the service always generates it
    # server-side on create (viewset.py's perform_create never reads it out of
    # validated_data) and validate_employee_number rejects a changed value on
    # update with a specific message — mirrors StudentSerializer.admission_number.
    employee_number = serializers.CharField(max_length=32, required=False)
    # The directory renders a campus, a department and a designation, not three
    # UUIDs. Same reasoning as StudentSerializer's campus_name: read through the FK
    # so retrieve and create work too, and lean on the select_related get_queryset
    # already does. Department and designation are both optional on a staff record.
    campus_name = serializers.CharField(source="campus.name", read_only=True)
    department_name = serializers.CharField(
        source="department.name", read_only=True, allow_null=True
    )
    designation_name = serializers.CharField(
        source="designation.name", read_only=True, allow_null=True
    )

    class Meta:
        model = Staff
        fields = (
            "id",
            "employee_number",
            "user_id",
            "first_name",
            "last_name",
            "gender",
            "date_of_birth",
            "photo_file_id",
            "staff_type",
            "campus_id",
            "campus_name",
            "department_id",
            "department_name",
            "designation_id",
            "designation_name",
            "reports_to_staff_id",
            "employment_type",
            "employment_status",
            "joining_date",
            "exit_date",
            "exit_reason",
            "email",
            "phone",
            "national_id",
            "public_bio",
            "address",
            "custom_fields",
            "created_at",
            "updated_at",
        )
        # employment_status/exit_date/exit_reason move only through the :exit
        # colon-action (§4/§7 exit workflow), never a plain PATCH.
        read_only_fields = (*READ_ONLY_FIELDS, "employment_status", "exit_date", "exit_reason")

    def validate_employee_number(self, value: str) -> str:
        if self.instance is not None:
            assert_employee_number_immutable(instance=self.instance, new_value=value)
        return value

    def validate_user_id(self, value: uuid.UUID | None) -> uuid.UUID | None:
        """Re-run on every write, not just create — see StudentSerializer's

        identical hook for why: ``perform_update`` saves a PATCH straight
        through with no tenant-ownership recheck of its own.
        """
        tenant = self.context["request"].tenant
        return resolve_tenant_user_id(user_id=value, tenant_id=tenant.pk)

    def validate_national_id(self, value: str | None) -> str | None:
        if value:
            tenant = self.context["request"].tenant
            assert_national_id_available(
                tenant_id=tenant.pk, national_id=value, instance=self.instance
            )
        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        department = attrs.get("department", getattr(self.instance, "department", None))
        designation = attrs.get("designation", getattr(self.instance, "designation", None))
        tenant = self.context["request"].tenant
        if department is not None:
            assert_department_active(department=department, tenant_id=tenant.pk)
        if designation is not None:
            assert_designation_active(designation=designation, tenant_id=tenant.pk)
        reports_to = attrs.get("reports_to", getattr(self.instance, "reports_to", None))
        if reports_to is not None:
            assert_reports_to_acyclic(staff=self.instance, reports_to=reports_to)
        return attrs


class InviteRequestSerializer(serializers.Serializer):
    """No email is sent (§17 gap — no notification infrastructure exists yet,
    see services/invite.py's ``invite_staff`` docstring); this only creates and
    links the account plus assigns the requested roles.
    """

    role_ids = serializers.ListField(
        child=serializers.UUIDField(), allow_empty=True, required=False, default=list
    )


class ExitRequestSerializer(serializers.Serializer):
    exit_date = serializers.DateField()
    exit_reason = serializers.CharField(max_length=300)
    # Optional, defaulting to the most common case — resignation — so existing callers
    # that only ever sent exit_date/exit_reason keep working unchanged; a caller that
    # knows this was a retirement or termination can now say so explicitly instead of
    # every exit being recorded as a resignation regardless of the real reason.
    exit_type = serializers.ChoiceField(
        choices=[EmploymentStatus.RESIGNED, EmploymentStatus.RETIRED, EmploymentStatus.TERMINATED],
        required=False,
        default=EmploymentStatus.RESIGNED,
    )


class StaffImportRequestSerializer(serializers.Serializer):
    """`POST /staff-imports` (multipart) — mirrors StudentImportRequestSerializer:

    the file goes straight into the background job's own payload, not through
    core.files' two-step presigned flow (that's for binary media served back
    out to users later; an import file is read once, synchronously).
    """

    file = serializers.FileField()
