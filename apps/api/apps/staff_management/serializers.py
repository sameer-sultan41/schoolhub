"""Serializers for the staff-management module.

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
from apps.staff_management import services
from apps.staff_management.models import Designation, Staff, StaffDocument, StaffQualification
from core.files.models import File

READ_ONLY_FIELDS = ("id", "created_at", "updated_at")


def _fk(model, **kwargs) -> serializers.PrimaryKeyRelatedField:
    """A tenant-scoped related field — see school_organization/serializers.py's

    identical helper for why the *manager*, not ``manager.all()``, is passed.
    """
    return serializers.PrimaryKeyRelatedField(queryset=model.objects, **kwargs)


class DesignationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Designation
        fields = (
            "id",
            "name",
            "code",
            "description",
            "level",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        is_active = attrs.get("is_active", getattr(self.instance, "is_active", True))
        if self.instance is not None and self.instance.is_active and is_active is False:
            services.assert_designation_deactivatable(designation=self.instance)
        return attrs


class StaffSerializer(serializers.ModelSerializer):
    campus_id = _fk(Campus, source="campus")
    department_id = _fk(Department, source="department", required=False, allow_null=True)
    designation_id = _fk(Designation, source="designation", required=False, allow_null=True)
    reports_to_staff_id = _fk(Staff, source="reports_to", required=False, allow_null=True)
    photo_file_id = _fk(File, source="photo_file", required=False, allow_null=True)
    # Explicitly optional, not read-only: the service always generates it
    # server-side on create (views.py's perform_create never reads it out of
    # validated_data) and validate_employee_number rejects a changed value on
    # update with a specific message — mirrors StudentSerializer.admission_number.
    employee_number = serializers.CharField(max_length=32, required=False)

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
            "department_id",
            "designation_id",
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
            services.assert_employee_number_immutable(instance=self.instance, new_value=value)
        return value

    def validate_user_id(self, value: uuid.UUID | None) -> uuid.UUID | None:
        """Re-run on every write, not just create — see StudentSerializer's

        identical hook for why: ``perform_update`` saves a PATCH straight
        through with no tenant-ownership recheck of its own.
        """
        tenant = self.context["request"].tenant
        return services.resolve_tenant_user_id(user_id=value, tenant_id=tenant.pk)

    def validate_national_id(self, value: str | None) -> str | None:
        if value:
            tenant = self.context["request"].tenant
            services.assert_national_id_available(
                tenant_id=tenant.pk, national_id=value, instance=self.instance
            )
        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        department = attrs.get("department", getattr(self.instance, "department", None))
        designation = attrs.get("designation", getattr(self.instance, "designation", None))
        tenant = self.context["request"].tenant
        if department is not None:
            services.assert_department_active(department=department, tenant_id=tenant.pk)
        if designation is not None:
            services.assert_designation_active(designation=designation, tenant_id=tenant.pk)
        reports_to = attrs.get("reports_to", getattr(self.instance, "reports_to", None))
        if reports_to is not None:
            services.assert_reports_to_acyclic(staff=self.instance, reports_to=reports_to)
        return attrs


class StaffQualificationSerializer(serializers.ModelSerializer):
    staff_id = serializers.UUIDField(read_only=True)
    document_file_id = _fk(File, source="document_file", required=False, allow_null=True)

    class Meta:
        model = StaffQualification
        fields = (
            "id",
            "staff_id",
            "qualification_type",
            "title",
            "institution",
            "field_of_study",
            "year_awarded",
            "grade",
            "document_file_id",
            "verification_status",
            "verified_by",
            "verified_at",
            "created_at",
            "updated_at",
        )
        # verification_status/verified_by/verified_at move only through the
        # :verify colon-action — never a plain PATCH.
        read_only_fields = (
            *READ_ONLY_FIELDS,
            "verification_status",
            "verified_by",
            "verified_at",
        )

    def validate_year_awarded(self, value: int | None) -> int | None:
        if value is not None:
            services.assert_year_not_future(value)
        return value

    def validate_document_file_id(self, value: File | None) -> File | None:
        if value is not None:
            services.assert_file_usable(file=value, purpose="staff.qualification")
        return value


class StaffDocumentSerializer(serializers.ModelSerializer):
    staff_id = serializers.UUIDField(read_only=True)
    file_id = _fk(File, source="file")

    class Meta:
        model = StaffDocument
        fields = (
            "id",
            "staff_id",
            "file_id",
            "document_type",
            "title",
            "notes",
            "verification_status",
            "verified_by",
            "verified_at",
            "expires_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            *READ_ONLY_FIELDS,
            "verification_status",
            "verified_by",
            "verified_at",
        )

    def validate_document_type(self, value: str) -> str:
        tenant = self.context["request"].tenant
        services.assert_document_type_allowed(document_type=value, tenant_id=tenant.pk)
        return value

    def validate_file_id(self, value: File) -> File:
        services.assert_file_usable(file=value, purpose="staff.document")
        return value


class VerifyRequestSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=["verified", "rejected"])


class InviteRequestSerializer(serializers.Serializer):
    """No email is sent (§17 gap — no notification infrastructure exists yet,
    see services.invite_staff's docstring); this only creates and links the
    account plus assigns the requested roles.
    """

    role_ids = serializers.ListField(
        child=serializers.UUIDField(), allow_empty=True, required=False, default=list
    )


class ExitRequestSerializer(serializers.Serializer):
    exit_date = serializers.DateField()
    exit_reason = serializers.CharField(max_length=300)


class StaffImportRequestSerializer(serializers.Serializer):
    """`POST /staff-imports` (multipart) — mirrors StudentImportRequestSerializer:

    the file goes straight into the background job's own payload, not through
    core.files' two-step presigned flow (that's for binary media served back
    out to users later; an import file is read once, synchronously).
    """

    file = serializers.FileField()
