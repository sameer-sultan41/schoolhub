"""`DesignationSerializer` — the tenant-defined designation catalog.

Shape validation lives here; the deactivation rule that needs to look at other
rows lives in ``designations/services.py`` and is invoked from ``validate()``
— mirrors apps/staff_management/serializers.py's own convention.
"""

from __future__ import annotations

from typing import Any

from rest_framework import serializers

from apps.staff_management.designations.services import assert_designation_deactivatable
from apps.staff_management.models import Designation
from apps.staff_management.serializers import READ_ONLY_FIELDS


class DesignationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Designation
        fields = (
            "id",
            "name",
            "code",
            "description",
            "level",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        is_active = attrs.get("is_active", getattr(self.instance, "is_active", True))
        if self.instance is not None and self.instance.is_active and is_active is False:
            assert_designation_deactivatable(designation=self.instance)
        return attrs
