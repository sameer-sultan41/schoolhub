"""Serializers for `/website-settings` and `/themes`."""

from __future__ import annotations

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.website_cms.models import Theme, WebsiteSettings


class SocialLinkSerializer(serializers.Serializer):
    platform = serializers.CharField(max_length=50)
    url = serializers.CharField(max_length=500)


class ThemeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Theme
        fields = [
            "id",
            "code",
            "name",
            "version",
            "description",
            "config_schema",
            "section_types",
        ]
        read_only_fields = fields


class WebsiteSettingsSerializer(serializers.ModelSerializer):
    exists = serializers.SerializerMethodField()
    theme_id = serializers.UUIDField(required=False)
    theme_code = serializers.CharField(source="theme.code", read_only=True)
    theme_version = serializers.CharField(source="theme.version", read_only=True)
    homepage_page_id = serializers.UUIDField(required=False)
    social_links = SocialLinkSerializer(many=True, required=False)

    class Meta:
        model = WebsiteSettings
        fields = [
            "exists",
            "theme_id",
            "theme_code",
            "theme_version",
            "theme_config",
            "homepage_page_id",
            "is_published",
            "maintenance_mode",
            "header_config",
            "footer_config",
            "social_links",
            "analytics_id",
            "default_locale",
            "updated_at",
        ]
        read_only_fields = ["updated_at"]

    @extend_schema_field(OpenApiTypes.BOOL)
    def get_exists(self, obj: WebsiteSettings) -> bool:
        """False for the unsaved default `GET` shows before the site exists."""
        return not obj._state.adding

    def _object(self, value: object, field: str) -> dict:
        if not isinstance(value, dict):
            raise serializers.ValidationError(f"{field} must be an object.")
        return value

    def validate_theme_config(self, value: object) -> dict:
        return self._object(value, "theme_config")

    def validate_header_config(self, value: object) -> dict:
        return self._object(value, "header_config")

    def validate_footer_config(self, value: object) -> dict:
        return self._object(value, "footer_config")
