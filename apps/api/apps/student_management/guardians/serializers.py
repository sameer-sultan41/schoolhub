"""`GuardianSerializer` — the standalone guardian person record.

Shared helpers (``_fk``, ``READ_ONLY_FIELDS``) stay in the app root — see
docs/03-modules/student-management.md §20. The student<->guardian link
(``StudentGuardian``) and its serializer are a separate resource package
(``student_guardians/``); this one is the guardian's own record only.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.student_management import uploads
from apps.student_management.models import Guardian
from apps.student_management.serializers import READ_ONLY_FIELDS, _fk
from apps.student_management.services import assert_file_usable
from core.files.models import File


class GuardianSerializer(serializers.ModelSerializer):
    photo_file_id = _fk(File, source="photo_file", required=False, allow_null=True)

    class Meta:
        model = Guardian
        fields = (
            "id",
            "user_id",
            "first_name",
            "last_name",
            "phone",
            "alt_phone",
            "email",
            "occupation",
            "employer",
            "national_id",
            "photo_file_id",
            "address",
            "custom_fields",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate_photo_file_id(self, value: File | None) -> File | None:
        # Mirrors Student.photo_file/StudentDocument.file: a resolved File still
        # needs its purpose and upload-confirmed status checked — the tenant-scoped
        # `_fk()` field only proves the id exists and belongs to this tenant.
        if value is not None:
            assert_file_usable(file=value, purpose=uploads.GUARDIAN_PHOTO.key)
        return value
