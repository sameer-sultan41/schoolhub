from __future__ import annotations

from rest_framework import serializers

from core.files.models import File


class FileSerializer(serializers.ModelSerializer):
    class Meta:
        model = File
        fields = (
            "id",
            "original_name",
            "mime_type",
            "size_bytes",
            "purpose",
            "status",
            "visibility",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class FileCreateSerializer(serializers.Serializer):
    """Input for ``POST /api/v1/files``."""

    original_name = serializers.CharField(max_length=255)
    mime_type = serializers.CharField(max_length=120)
    size_bytes = serializers.IntegerField(min_value=1)
    purpose = serializers.CharField(max_length=40)
