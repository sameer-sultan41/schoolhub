"""Serializers for `/school-events`."""

from __future__ import annotations

from rest_framework import serializers

from apps.website_cms.models import SchoolEvent


class SchoolEventListSerializer(serializers.ModelSerializer):
    class Meta:
        model = SchoolEvent
        fields = [
            "id",
            "title",
            "slug",
            "starts_at",
            "ends_at",
            "is_all_day",
            "location",
            "cover_image_file_id",
            "status",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class SchoolEventDetailSerializer(SchoolEventListSerializer):
    class Meta(SchoolEventListSerializer.Meta):
        fields = [*SchoolEventListSerializer.Meta.fields, "description"]
        read_only_fields = fields


class SchoolEventWriteSerializer(serializers.ModelSerializer):
    """Input for create and PATCH; slug, description and date-range rules live in the service."""

    description = serializers.JSONField(required=False)

    class Meta:
        model = SchoolEvent
        fields = [
            "title",
            "slug",
            "description",
            "starts_at",
            "ends_at",
            "is_all_day",
            "location",
            "cover_image_file_id",
        ]
        extra_kwargs = {
            "slug": {"max_length": None},
            "ends_at": {"required": False},
            "is_all_day": {"required": False},
            "location": {"required": False},
            "cover_image_file_id": {"required": False},
        }
