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

    ``expected_purpose``, when given, gates the signed link on the attached file's own
    ``purpose`` matching it: ``None`` instead of a signed URL for a mismatched file. A
    relation's own FK field (e.g. ``_fk(File, source="photo_file")``) only proves the file
    exists and belongs to this tenant, not that it was uploaded for this purpose — and a
    row's ``photo_file`` can predate a purpose check being added to that FK's own
    ``validate_*`` method at all, so this field re-checks it on every read rather than
    trusting that the relation can only ever point at the right kind of file. Formerly
    hand-rolled identically by both ``StudentSerializer.get_photo_url`` and
    ``GuardianSerializer.get_photo_url`` before both were consolidated onto this field.
    """

    def __init__(self, *, expected_purpose: str | None = None, **kwargs: Any) -> None:
        kwargs["read_only"] = True
        kwargs.setdefault("allow_null", True)
        self.expected_purpose = expected_purpose
        super().__init__(**kwargs)

    def to_representation(self, value: File) -> str | None:
        if self.expected_purpose is not None and value.purpose != self.expected_purpose:
            return None
        return get_display_url(value)
