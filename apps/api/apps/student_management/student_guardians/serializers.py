"""Serializer for the StudentGuardian *link* — see this package's
``services.py`` docstring for the link/record split against the sibling
``guardians`` package.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.student_management.models import Guardian, StudentGuardian
from apps.student_management.serializers import READ_ONLY_FIELDS, _fk


class StudentGuardianSerializer(serializers.ModelSerializer):
    """Used both for the nested `POST /students/{id}/guardians` (student comes

    from the URL, not the body — see the viewset) and the top-level
    `PATCH /student-guardians/{id}` (link-flag updates only).
    """

    student_id = serializers.UUIDField(read_only=True)
    guardian_id = _fk(Guardian, source="guardian")

    class Meta:
        model = StudentGuardian
        fields = (
            "id",
            "student_id",
            "guardian_id",
            "relationship",
            "is_primary",
            "is_fee_responsible",
            "can_pick_up",
            "receives_communications",
            "has_portal_access",
            "access_revoked_reason",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS
