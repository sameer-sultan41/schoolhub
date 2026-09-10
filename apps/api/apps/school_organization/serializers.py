"""Serializers for the school-organization module.

Shape validation lives here; rules that need to look at other rows live in
``services`` and are called from ``validate()`` so the same rule applies whether
the write arrives from the API, the bulk importer or a Celery job.

Foreign keys are exposed with their ``_id`` suffix to match the column names in
docs/05-database/entities/academics.md and the filter names in the
module doc §16.

``CampusSerializer``, ``DepartmentSerializer``, ``AcademicSessionSerializer``,
``SessionCloneSerializer`` and ``TermSerializer`` moved to their own packages
(``campuses/serializers.py``, ``departments/serializers.py``,
``academic_sessions/serializers.py``, ``terms/serializers.py``) — this file
now holds only the resources that haven't been split into their own package
yet.
"""

from __future__ import annotations

from typing import Any

from rest_framework import serializers

from apps.school_organization import services
from apps.school_organization.models import Campus, Class, Department, House, Section, Subject
from apps.school_organization.serializer_helpers import READ_ONLY_FIELDS, fk, normalize_code


class ClassSerializer(serializers.ModelSerializer):
    class Meta:
        model = Class
        fields = ("id", "name", "code", "level", "is_active", "created_at", "updated_at")
        read_only_fields = READ_ONLY_FIELDS

    def validate_code(self, value: str | None) -> str | None:
        return normalize_code(value)

    def validate_level(self, value: int) -> int:
        if value < 1:
            raise serializers.ValidationError("level starts at 1; it orders the promotion ladder.")
        return value


class SectionSerializer(serializers.ModelSerializer):
    class_id = fk(Class, source="school_class")
    campus_id = fk(Campus, source="campus")

    class Meta:
        model = Section
        fields = (
            "id",
            "class_id",
            "campus_id",
            "name",
            "capacity",
            "class_teacher_staff_id",
            "room_id",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate_capacity(self, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise serializers.ValidationError("capacity must be at least 1, or null for unlimited.")
        return value

    def validate_class_teacher_staff_id(self, value):
        return services.resolve_tenant_staff_id(
            staff_id=value, tenant_id=self.context["request"].tenant.pk
        )

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        school_class = attrs.get("school_class") or getattr(self.instance, "school_class", None)
        campus = attrs.get("campus") or getattr(self.instance, "campus", None)

        if school_class is not None and not school_class.is_active:
            raise serializers.ValidationError(
                {"class_id": f"Class '{school_class.name}' is inactive."}
            )
        if campus is not None and not campus.is_active:
            raise serializers.ValidationError({"campus_id": f"Campus '{campus.name}' is inactive."})
        return attrs


class SubjectSerializer(serializers.ModelSerializer):
    department_id = fk(Department, source="department", required=False, allow_null=True)

    class Meta:
        model = Subject
        fields = (
            "id",
            "name",
            "code",
            "subject_type",
            "department_id",
            "description",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate_code(self, value: str) -> str:
        return normalize_code(value)


# `ClassSubjectSerializer` lived here until `/class-subjects` moved to academics
# in this PR. Nothing routed to it afterwards, so it is gone rather than left as
# a second definition of the same wire shape for someone to edit by mistake.
# `apps/academics/serializers.py::CurriculumSerializer` is the one.


class HouseSerializer(serializers.ModelSerializer):
    class Meta:
        model = House
        fields = (
            "id",
            "name",
            "code",
            "color",
            "motto",
            "house_master_staff_id",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate_code(self, value: str | None) -> str | None:
        return normalize_code(value)

    def validate_house_master_staff_id(self, value):
        return services.resolve_tenant_staff_id(
            staff_id=value, tenant_id=self.context["request"].tenant.pk
        )


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
