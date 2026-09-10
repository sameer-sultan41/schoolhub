"""`SchoolSettingsSerializer` — `/school-settings` request/response shape
(module doc §16, singleton resource).
"""

from __future__ import annotations

from rest_framework import serializers

from apps.school_organization import services


class SchoolSettingsSerializer(serializers.Serializer):
    """School profile and academic configuration (module doc §16, singleton resource).

    Backed by ``tenant_settings`` JSONB rather than its own table: the shape is
    tenant-configurable (accreditation fields, holiday calendar, weekend definition)
    and columns would force a migration per school that wants one more field.
    """

    branding = serializers.JSONField(required=False)
    academic = serializers.JSONField(required=False)
    timezone = serializers.CharField(max_length=64, required=False)
    locale = serializers.CharField(max_length=10, required=False)
    currency = serializers.CharField(min_length=3, max_length=3, required=False)

    def validate_timezone(self, value: str) -> str:
        if not services.is_valid_timezone(value):
            raise serializers.ValidationError(f"'{value}' is not a valid IANA timezone.")
        return value

    def validate_currency(self, value: str) -> str:
        # ISO 4217 alphabetic codes only; no country is assumed for the tenant (§11).
        if not value.isalpha():
            raise serializers.ValidationError("currency must be a 3-letter ISO 4217 code.")
        return value.upper()
