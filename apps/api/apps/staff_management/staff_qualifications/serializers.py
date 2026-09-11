"""Serializer for the staff-qualifications resource.

Shape validation lives here; rules that need to look at other rows live in
``staff_qualifications.services`` and are invoked from ``validate_*``, so the
same rule applies whether the write arrives from the API or the bulk
importer — mirrors the root ``apps.staff_management.serializers`` layering.

Foreign keys are exposed with their ``_id`` suffix to match the column names
in docs/05-database/entities/people.md and the filter names in the module doc
§16.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.staff_management import uploads
from apps.staff_management.models import StaffQualification
from apps.staff_management.serializers import READ_ONLY_FIELDS, _fk
from apps.staff_management.services import assert_file_usable
from apps.staff_management.staff_qualifications.services import assert_year_not_future
from core.files.models import File


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
            assert_year_not_future(value)
        return value

    def validate_document_file_id(self, value: File | None) -> File | None:
        if value is not None:
            assert_file_usable(file=value, purpose=uploads.STAFF_QUALIFICATION.key)
        return value
