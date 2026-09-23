"""`RoomSerializer` — physical rooms, labs and halls (§5.4).

Shape follows the module's own convention (apps/timetable/serializers.py's
docstring): FKs are exposed with an `_id` suffix over the tenant-scoped
default manager, via the shared `_fk()` helper, and lifecycle fields are
read-only through the shared `READ_ONLY_FIELDS` tuple — both stay in the
trimmed root `serializers.py` since other resource packages use them too.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.school_organization.models import Campus
from apps.timetable.models import Room
from apps.timetable.serializers import READ_ONLY_FIELDS, _fk


class RoomSerializer(serializers.ModelSerializer):
    """`rooms` — physical rooms, labs and halls (§5.4)."""

    campus_id = _fk(Campus, source="campus")

    class Meta:
        model = Room
        fields = (
            "id",
            "campus_id",
            "name",
            "code",
            "room_type",
            "capacity",
            "building",
            "floor",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate_capacity(self, value: int | None) -> int | None:
        """A zero-capacity room seats nobody, which no slot can ever satisfy.

        The model column is a `PositiveSmallIntegerField`, so 0 is storable and
        would otherwise sit there generating a `room_over_capacity` soft warning
        on every slot forever.
        """
        if value is not None and value < 1:
            raise serializers.ValidationError("A room must seat at least one student.")
        return value
