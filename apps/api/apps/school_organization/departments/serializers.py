"""`DepartmentSerializer` — `/departments` request/response shape (module doc §5.3).

Foreign keys are exposed with their ``_id`` suffix to match the column names in
docs/05-database/entities/academics.md and the filter names in the module doc
§16.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.school_organization import services
from apps.school_organization.models import Campus, Department
from apps.school_organization.serializer_helpers import READ_ONLY_FIELDS, fk, normalize_code


class DepartmentSerializer(serializers.ModelSerializer):
    campus_id = fk(Campus, source="campus", required=False, allow_null=True)

    class Meta:
        model = Department
        fields = (
            "id",
            "name",
            "code",
            "department_type",
            "campus_id",
            "head_staff_id",
            "description",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate_code(self, value: str) -> str:
        return normalize_code(value)

    def validate_head_staff_id(self, value):
        return services.resolve_tenant_staff_id(
            staff_id=value, tenant_id=self.context["request"].tenant.pk
        )
