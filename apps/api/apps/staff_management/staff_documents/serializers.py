"""`StaffDocumentSerializer` — shape validation for the StaffDocument resource.

Shared helpers (``_fk``, ``READ_ONLY_FIELDS``) and ``VerifyRequestSerializer``
stay in the app root — see docs/03-modules/staff-management.md §20.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.staff_management import uploads
from apps.staff_management.models import StaffDocument
from apps.staff_management.serializers import READ_ONLY_FIELDS, _fk
from apps.staff_management.services import assert_file_usable
from apps.staff_management.staff_documents.services import assert_document_type_allowed
from core.files.models import File


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
        assert_document_type_allowed(document_type=value, tenant_id=tenant.pk)
        return value

    def validate_file_id(self, value: File) -> File:
        assert_file_usable(file=value, purpose=uploads.STAFF_DOCUMENT.key)
        return value
