"""`HolidayCalendarSerializer` — `/holiday-calendar` request/response shape
(module doc §5.8, §16).
"""

from __future__ import annotations

from rest_framework import serializers

from apps.school_organization.models import Campus


class HolidayEntrySerializer(serializers.Serializer):
    """One holiday or holiday range — module doc §5.8.

    ``campus_id`` is a plain ``UUIDField`` rather than a ``PrimaryKeyRelatedField``
    because these entries live inside JSONB, where there is no foreign key to do
    the ownership check for us. ``validate_campus_id`` does it explicitly, or a
    smuggled foreign id would be stored unchallenged and then silently ignored by
    ``calendar.holiday_name`` — a closure an admin believes they configured and
    which never takes effect.

    ``start_date``/``end_date`` rather than §16's filter names ``from``/``to``:
    ``from`` is a Python keyword, so it can be neither a serializer attribute nor
    a comfortable key for any Python that later reads the stored entry. §16 uses
    ``from``/``to`` for *query parameters*, which is a different namespace, and
    those filters are not built (the resource is a singleton document).
    """

    start_date = serializers.DateField()
    end_date = serializers.DateField(required=False)
    name = serializers.CharField(max_length=120)
    campus_id = serializers.UUIDField(required=False, allow_null=True, default=None)

    def validate(self, attrs: dict) -> dict:
        # A single-day holiday may omit `end_date`; defaulting it here keeps the
        # stored shape uniform, so the calendar reader never has to guess.
        if attrs.get("end_date") is None:
            attrs["end_date"] = attrs["start_date"]
        if attrs["end_date"] < attrs["start_date"]:
            raise serializers.ValidationError(
                {"end_date": "A holiday cannot end before it starts."}
            )
        return attrs

    def validate_campus_id(self, value):
        if value is None:
            return None
        if not Campus.objects.alive().filter(pk=value).exists():
            raise serializers.ValidationError("No such campus.")
        return value


class HolidayCalendarSerializer(serializers.Serializer):
    """``GET/PUT /api/v1/holiday-calendar`` (§16).

    PUT replaces each list it names wholesale, which is why this is a PUT and not
    a PATCH: merging entry by entry would leave no way to *remove* a holiday, and
    removing one is exactly what a cancelled closure needs.
    """

    working_days = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=6),
        required=False,
        help_text="0=Monday. Omit to leave the configured week unchanged.",
    )
    holidays = serializers.ListField(child=HolidayEntrySerializer(), required=False)

    def validate_working_days(self, value: list[int]) -> list[int]:
        if not value:
            raise serializers.ValidationError("A school must operate on at least one weekday.")
        return sorted(set(value))
