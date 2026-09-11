"""`AcademicSessionSerializer`/`SessionCloneSerializer` — `/academic-sessions` shapes
(module doc §5.4, §7).
"""

from __future__ import annotations

from typing import Any

from rest_framework import serializers

from apps.school_organization.academic_sessions.services.validate import (
    assert_no_session_overlap,
)
from apps.school_organization.models import AcademicSession
from apps.school_organization.serializer_helpers import READ_ONLY_FIELDS


class AcademicSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = AcademicSession
        fields = (
            "id",
            "name",
            "start_date",
            "end_date",
            "status",
            "is_current",
            "created_at",
            "updated_at",
        )
        # Lifecycle moves only through :activate and :close, which are separately
        # permissioned and audited; a plain PATCH must not be able to flip them.
        read_only_fields = (*READ_ONLY_FIELDS, "status", "is_current")

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        start = attrs.get("start_date") or getattr(self.instance, "start_date", None)
        end = attrs.get("end_date") or getattr(self.instance, "end_date", None)
        if start is None or end is None:
            raise serializers.ValidationError(
                {"start_date": "Both start_date and end_date are required."}
            )
        assert_no_session_overlap(
            start_date=start, end_date=end, exclude_id=getattr(self.instance, "pk", None)
        )
        return attrs


class SessionCloneSerializer(serializers.Serializer):
    """Input for ``POST /academic-sessions/{id}:clone`` — the new session's identity."""

    name = serializers.CharField(max_length=50)
    start_date = serializers.DateField()
    end_date = serializers.DateField()
