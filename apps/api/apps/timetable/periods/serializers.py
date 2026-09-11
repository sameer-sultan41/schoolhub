"""Serializer for `periods` — the bell schedule (§5.1).

Shape follows the rest of the module: FKs are exposed with an `_id` suffix over
the tenant-scoped default manager (so a foreign-tenant id fails to resolve and
yields a 400 rather than leaking whether the row exists), an explicit `fields`
tuple, and lifecycle fields read-only.

`validate` delegates to `services.assert_period_does_not_overlap` rather than
restating the rule: the importer and any future caller apply the same check,
and a rule implemented twice is a rule that drifts.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.school_organization.models import Campus
from apps.timetable.models import Period
from apps.timetable.periods import services
from apps.timetable.serializers import READ_ONLY_FIELDS, _fk


class PeriodSerializer(serializers.ModelSerializer):
    """`periods` — one slot of the bell schedule (§5.1).

    `campus_id` is optional and null means "every campus" (models.py), which is
    why it is `allow_null` rather than merely `required=False`: a client editing
    a campus period back to tenant-wide has to be able to say so explicitly.
    """

    campus_id = _fk(Campus, source="campus", required=False, allow_null=True)

    class Meta:
        model = Period
        fields = (
            "id",
            "campus_id",
            "name",
            "sequence",
            "start_time",
            "end_time",
            "is_break",
            "weekdays",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate_weekdays(self, value):
        """`weekdays` is free-form JSON in the column; §5.1 means 0-6 day indexes.

        Without this a `{"mon": true}` payload stores happily and then silently
        means nothing to every reader of the column.
        """
        if value is None:
            return value
        if not isinstance(value, list) or not all(
            isinstance(day, int) and not isinstance(day, bool) and 0 <= day <= 6 for day in value
        ):
            raise serializers.ValidationError("Expected a list of weekday numbers, 0-6.")
        if len(set(value)) != len(value):
            raise serializers.ValidationError("Weekdays must not repeat.")
        return value

    def validate(self, attrs: dict) -> dict:
        """§11's non-overlap rule, plus the ordering the database also checks.

        The `periods_end_after_start` check constraint would catch a reversed
        pair, but it surfaces as a 409 with no field attached — the same failure
        mode academics' `validate_weekly_periods` exists to avoid — so the
        ordering is mirrored here to give the form a field to highlight.
        """
        start = attrs.get("start_time", getattr(self.instance, "start_time", None))
        end = attrs.get("end_time", getattr(self.instance, "end_time", None))
        if start is not None and end is not None and end <= start:
            raise serializers.ValidationError({"end_time": "The end time must be after the start."})

        campus = attrs.get("campus", getattr(self.instance, "campus", None))
        services.assert_period_does_not_overlap(
            campus_id=campus.pk if campus else None,
            start_time=start,
            end_time=end,
            exclude_pk=self.instance.pk if self.instance else None,
        )
        return attrs
