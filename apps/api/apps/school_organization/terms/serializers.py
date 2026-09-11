"""`TermSerializer` — `/terms` request/response shape (module doc §5.4).

Foreign keys are exposed with their ``_id`` suffix to match the column names in
docs/05-database/entities/academics.md and the filter names in the module doc
§16.
"""

from __future__ import annotations

from typing import Any

from rest_framework import serializers

from apps.school_organization import services
from apps.school_organization.models import AcademicSession, Term
from apps.school_organization.serializer_helpers import READ_ONLY_FIELDS, fk
from apps.school_organization.terms.services import assert_term_window


class TermSerializer(serializers.ModelSerializer):
    academic_session_id = fk(AcademicSession, source="academic_session")

    class Meta:
        model = Term
        fields = (
            "id",
            "academic_session_id",
            "name",
            "sequence",
            "start_date",
            "end_date",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        session = attrs.get("academic_session") or getattr(self.instance, "academic_session", None)
        start = attrs.get("start_date") or getattr(self.instance, "start_date", None)
        end = attrs.get("end_date") or getattr(self.instance, "end_date", None)
        if session is None:
            raise serializers.ValidationError({"academic_session_id": "This field is required."})
        if start is None or end is None:
            raise serializers.ValidationError(
                {"start_date": "Both start_date and end_date are required."}
            )

        services.assert_session_writable(session)
        assert_term_window(
            session=session,
            start_date=start,
            end_date=end,
            exclude_id=getattr(self.instance, "pk", None),
        )
        return attrs
