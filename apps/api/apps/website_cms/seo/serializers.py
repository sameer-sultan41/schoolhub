"""Serializers for `/seo-settings`."""

from __future__ import annotations

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.website_cms.models import SeoSetting, SeoTargetType

_TEXT = {"required": False, "allow_null": True, "allow_blank": True}


class SeoTargetQuerySerializer(serializers.Serializer):
    target_type = serializers.ChoiceField(choices=SeoTargetType.choices)
    target_id = serializers.UUIDField(required=False)


class SeoSettingSerializer(serializers.ModelSerializer):
    exists = serializers.SerializerMethodField()
    target_id = serializers.UUIDField(read_only=True, allow_null=True)
    meta_title = serializers.CharField(max_length=70, **_TEXT)
    meta_description = serializers.CharField(max_length=170, **_TEXT)
    canonical_url = serializers.CharField(max_length=500, **_TEXT)
    robots = serializers.CharField(max_length=50, **_TEXT)
    og_image_file_id = serializers.UUIDField(required=False, allow_null=True)
    # Read-only until the renderer defines a JSON-LD shape and its escaping (deferred-work.md).
    structured_data = serializers.JSONField(read_only=True, allow_null=True)

    class Meta:
        model = SeoSetting
        fields = [
            "exists",
            "target_type",
            "target_id",
            "meta_title",
            "meta_description",
            "og_image_file_id",
            "canonical_url",
            "robots",
            "structured_data",
            "updated_at",
        ]
        read_only_fields = ["target_type", "updated_at"]

    @extend_schema_field(OpenApiTypes.BOOL)
    def get_exists(self, obj: SeoSetting) -> bool:
        """False for the unsaved default `GET` shows before the row exists."""
        return not obj._state.adding

    def to_internal_value(self, data):
        values = super().to_internal_value(data)
        # Blank text clears the field, so one stored shape (null) means "unset".
        return {k: (None if v == "" else v) for k, v in values.items()}
