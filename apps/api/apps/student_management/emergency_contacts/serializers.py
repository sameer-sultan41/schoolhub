"""`EmergencyContactSerializer` — shape validation for the EmergencyContact resource.

The shared ``READ_ONLY_FIELDS`` tuple stays in the app root and is imported
from there — see apps.student_management.serializers.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.student_management.models import EmergencyContact
from apps.student_management.serializers import READ_ONLY_FIELDS


class EmergencyContactSerializer(serializers.ModelSerializer):
    student_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = EmergencyContact
        fields = (
            "id",
            "student_id",
            "name",
            "relationship",
            "phone",
            "alt_phone",
            "priority",
            "notes",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS
