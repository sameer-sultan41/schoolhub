from __future__ import annotations

from typing import Any

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from core.files.models import File
from core.files.services import get_display_url


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


@extend_schema_field(OpenApiTypes.URI)
class SignedFileURLField(serializers.Field):
    """Read-only, time-limited display link for the file behind a ``File`` foreign key.

    ``source`` names the relation: ``SignedFileURLField(source="photo_file")``. DRF emits
    ``null`` for an empty relation; ``get_display_url`` decides the rest. Pair it with
    ``select_related`` on that relation, or every row costs a query.
    """

    def __init__(self, **kwargs: Any) -> None:
        kwargs["read_only"] = True
        kwargs.setdefault("allow_null", True)
        super().__init__(**kwargs)

    def to_representation(self, value: File) -> str | None:
        return get_display_url(value)
