"""`SubjectSerializer` — `/subjects` request/response shape (module doc §5.6)."""

from __future__ import annotations

from rest_framework import serializers

from apps.school_organization.models import Department, Subject
from apps.school_organization.serializer_helpers import READ_ONLY_FIELDS, fk, normalize_code


class SubjectSerializer(serializers.ModelSerializer):
    department_id = fk(Department, source="department", required=False, allow_null=True)

    class Meta:
        model = Subject
        fields = (
            "id",
            "name",
            "code",
            "subject_type",
            "department_id",
            "description",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate_code(self, value: str) -> str:
        return normalize_code(value)


# `ClassSubjectSerializer` lived in the old flat `serializers.py` until
# `/class-subjects` moved to academics. Nothing routed to it afterwards, so it
# stayed gone rather than moving here as a second definition of the same wire
# shape for someone to edit by mistake. `apps/academics/serializers.py::
# CurriculumSerializer` is the one.
