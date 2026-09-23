"""`SectionSerializer` — `/sections` request/response shape (module doc §5.5).

Foreign keys are exposed with their ``_id`` suffix to match the column names in
docs/05-database/entities/academics.md and the filter names in the module doc
§16.
"""

from __future__ import annotations

from typing import Any

from rest_framework import serializers

from apps.school_organization import services
from apps.school_organization.models import Campus, Class, Section
from apps.school_organization.serializer_helpers import READ_ONLY_FIELDS, fk


class SectionSerializer(serializers.ModelSerializer):
    class_id = fk(Class, source="school_class")
    campus_id = fk(Campus, source="campus")

    class Meta:
        model = Section
        fields = (
            "id",
            "class_id",
            "campus_id",
            "name",
            "capacity",
            "class_teacher_staff_id",
            "room_id",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate_capacity(self, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise serializers.ValidationError("capacity must be at least 1, or null for unlimited.")
        return value

    def validate_class_teacher_staff_id(self, value):
        return services.resolve_tenant_staff_id(
            staff_id=value, tenant_id=self.context["request"].tenant.pk
        )

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        school_class = attrs.get("school_class") or getattr(self.instance, "school_class", None)
        campus = attrs.get("campus") or getattr(self.instance, "campus", None)

        if school_class is not None and not school_class.is_active:
            raise serializers.ValidationError(
                {"class_id": f"Class '{school_class.name}' is inactive."}
            )
        if campus is not None and not campus.is_active:
            raise serializers.ValidationError({"campus_id": f"Campus '{campus.name}' is inactive."})
        return attrs
