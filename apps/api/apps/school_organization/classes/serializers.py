"""`ClassSerializer` — `/classes` request/response shape (module doc §5.5)."""

from __future__ import annotations

from rest_framework import serializers

from apps.school_organization.models import Class
from apps.school_organization.serializer_helpers import READ_ONLY_FIELDS, normalize_code


class ClassSerializer(serializers.ModelSerializer):
    class Meta:
        model = Class
        fields = ("id", "name", "code", "level", "is_active", "created_at", "updated_at")
        read_only_fields = READ_ONLY_FIELDS

    def validate_code(self, value: str | None) -> str | None:
        return normalize_code(value)

    def validate_level(self, value: int) -> int:
        if value < 1:
            raise serializers.ValidationError("level starts at 1; it orders the promotion ladder.")
        return value
