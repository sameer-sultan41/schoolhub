"""`/school-settings` request and response shapes (module doc §16, singleton resource)."""

from __future__ import annotations

import re

from rest_framework import serializers

from apps.school_organization import services

# A colour in data is a hex string, never a class name (the `TenantBranding` contract in
# `packages/types/src/tenant.ts`): the dashboard and the website both read it as CSS.
HEX_COLOR = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


class SchoolSettingsSerializer(serializers.Serializer):
    """School profile and academic configuration, as `GET` and `PATCH` return it.

    `name` is the tenant's own name and `logo_file_id` a real column; `branding` and
    `academic` live in `tenant_settings` JSONB, because their shape is tenant-configurable and
    columns would force a migration per school that wants one more field.
    """

    name = serializers.CharField(read_only=True)
    logo_file_id = serializers.UUIDField(read_only=True, allow_null=True)
    logo_url = serializers.CharField(
        read_only=True, allow_null=True, help_text="A short-lived signed link to the logo."
    )
    branding = serializers.JSONField(read_only=True)
    academic = serializers.JSONField(read_only=True)
    timezone = serializers.CharField(read_only=True)
    locale = serializers.CharField(read_only=True)
    currency = serializers.CharField(read_only=True)


class SchoolSettingsUpdateSerializer(serializers.Serializer):
    """`PATCH /school-settings`: every field optional. `slug`, `status` and `academic` are not
    fields, so a body that sends them is ignored rather than written. `academic` is written only
    by `/holiday-calendar` and `/attendance-settings`, each of which validates its own keys."""

    name = serializers.CharField(max_length=200, required=False)
    logo_file_id = serializers.UUIDField(
        required=False,
        allow_null=True,
        help_text="A ready `school.logo` upload of this school; null removes the logo.",
    )
    branding = serializers.JSONField(
        required=False, help_text="Merged into the stored branding, key by key."
    )
    timezone = serializers.CharField(max_length=64, required=False)
    locale = serializers.CharField(max_length=10, required=False)
    currency = serializers.CharField(min_length=3, max_length=3, required=False)

    def validate_branding(self, value: object) -> dict:
        if not isinstance(value, dict):
            raise serializers.ValidationError("branding must be an object.")
        color = value.get("primary_color")
        if color is not None and not (isinstance(color, str) and HEX_COLOR.match(color)):
            raise serializers.ValidationError(
                {"primary_color": "Enter a hex colour such as #1E88E5."}
            )
        return value

    def validate_timezone(self, value: str) -> str:
        if not services.is_valid_timezone(value):
            raise serializers.ValidationError(f"'{value}' is not a valid IANA timezone.")
        return value

    def validate_currency(self, value: str) -> str:
        # ISO 4217 alphabetic codes only; no country is assumed for the tenant (§11).
        if not value.isalpha():
            raise serializers.ValidationError("currency must be a 3-letter ISO 4217 code.")
        return value.upper()
