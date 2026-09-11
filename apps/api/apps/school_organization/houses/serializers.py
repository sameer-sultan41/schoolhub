"""`HouseSerializer` — `/houses` request/response shape (module doc §5.7)."""

from __future__ import annotations

from rest_framework import serializers

from apps.school_organization import services
from apps.school_organization.models import House
from apps.school_organization.serializer_helpers import READ_ONLY_FIELDS, normalize_code


class HouseSerializer(serializers.ModelSerializer):
    class Meta:
        model = House
        fields = (
            "id",
            "name",
            "code",
            "color",
            "motto",
            "house_master_staff_id",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate_code(self, value: str | None) -> str | None:
        return normalize_code(value)

    def validate_house_master_staff_id(self, value):
        return services.resolve_tenant_staff_id(
            staff_id=value, tenant_id=self.context["request"].tenant.pk
        )
