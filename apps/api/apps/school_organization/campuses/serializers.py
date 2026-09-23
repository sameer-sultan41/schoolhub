"""`CampusSerializer` — `/campuses` request/response shape (module doc §5.2).

Foreign keys are exposed with their ``_id`` suffix to match the column names in
docs/05-database/entities/academics.md and the filter names in the module doc
§16.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.school_organization import services
from apps.school_organization.models import Campus
from apps.school_organization.serializer_helpers import READ_ONLY_FIELDS, normalize_code


class CampusSerializer(serializers.ModelSerializer):
    class Meta:
        model = Campus
        fields = (
            "id",
            "name",
            "code",
            "address",
            "phone",
            "email",
            "timezone",
            "head_staff_id",
            "is_primary",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate_code(self, value: str) -> str:
        return normalize_code(value)

    def validate_timezone(self, value: str | None) -> str | None:
        if value and not services.is_valid_timezone(value):
            raise serializers.ValidationError(f"'{value}' is not a valid IANA timezone.")
        return value

    def validate_head_staff_id(self, value):
        return services.resolve_tenant_staff_id(
            staff_id=value, tenant_id=self.context["request"].tenant.pk
        )
