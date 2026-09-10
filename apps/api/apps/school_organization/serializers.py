"""Serializers for the school-organization module.

Shape validation lives here; rules that need to look at other rows live in
``services`` and are called from ``validate()`` so the same rule applies whether
the write arrives from the API, the bulk importer or a Celery job.

Foreign keys are exposed with their ``_id`` suffix to match the column names in
docs/05-database/entities/academics.md and the filter names in the
module doc §16.

``CampusSerializer``, ``DepartmentSerializer``, ``AcademicSessionSerializer``,
``SessionCloneSerializer``, ``TermSerializer``, ``ClassSerializer``,
``SectionSerializer``, ``SubjectSerializer`` and ``HouseSerializer`` moved to
their own packages (``campuses/serializers.py``, ``departments/
serializers.py``, ``academic_sessions/serializers.py``, ``terms/
serializers.py``, ``classes/serializers.py``, ``sections/serializers.py``,
``subjects/serializers.py``, ``houses/serializers.py``) — this file now
holds only the two singleton-resource serializers (``school_settings/``,
``holiday_calendar/``) that haven't moved into their own package yet.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.school_organization import services
from apps.school_organization.models import Campus


class SchoolSettingsSerializer(serializers.Serializer):
    """School profile and academic configuration (module doc §16, singleton resource).

    Backed by ``tenant_settings`` JSONB rather than its own table: the shape is
    tenant-configurable (accreditation fields, holiday calendar, weekend definition)
    and columns would force a migration per school that wants one more field.
    """

    branding = serializers.JSONField(required=False)
    academic = serializers.JSONField(required=False)
    timezone = serializers.CharField(max_length=64, required=False)
    locale = serializers.CharField(max_length=10, required=False)
    currency = serializers.CharField(min_length=3, max_length=3, required=False)

    def validate_timezone(self, value: str) -> str:
        if not services.is_valid_timezone(value):
            raise serializers.ValidationError(f"'{value}' is not a valid IANA timezone.")
        return value

    def validate_currency(self, value: str) -> str:
        # ISO 4217 alphabetic codes only; no country is assumed for the tenant (§11).
        if not value.isalpha():
            raise serializers.ValidationError("currency must be a 3-letter ISO 4217 code.")
        return value.upper()


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
