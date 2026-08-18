"""Serializers for the school-organization module.

Shape validation lives here; rules that need to look at other rows live in
``services`` and are called from ``validate()`` so the same rule applies whether
the write arrives from the API, the bulk importer or a Celery job.

Foreign keys are exposed with their ``_id`` suffix to match the column names in
schoolhub-srd/docs/05-database/entities/academics.md and the filter names in the
module doc §16.
"""

from __future__ import annotations

from typing import Any, overload

from rest_framework import serializers

from apps.school_organization import services
from apps.school_organization.models import (
    AcademicSession,
    Campus,
    Class,
    ClassSubject,
    Department,
    House,
    Section,
    Subject,
    Term,
)

# Written by the base viewset from the request, never by the client.
READ_ONLY_FIELDS = ("id", "created_at", "updated_at")


def _fk(model, **kwargs) -> serializers.PrimaryKeyRelatedField:
    """A tenant-scoped related field.

    The *manager* is passed rather than ``manager.all()``: DRF re-evaluates it on
    every request, so the tenant filter runs inside a tenant context. A queryset
    built at import time would be frozen empty, and would silently reject every id.
    """
    return serializers.PrimaryKeyRelatedField(queryset=model.objects, **kwargs)


@overload
def _normalize_code(value: str) -> str: ...


@overload
def _normalize_code(value: None) -> None: ...


def _normalize_code(value: str | None) -> str | None:
    """Codes are matched by humans and by importers; case and padding are noise."""
    return value.strip().upper() if value else value


class CampusSerializer(serializers.ModelSerializer):
    class Meta:
        model = Campus
        fields = (
            "id", "name", "code", "address", "phone", "email", "timezone",
            "head_staff_id", "is_primary", "is_active", "created_at", "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate_code(self, value: str) -> str:
        return _normalize_code(value)

    def validate_timezone(self, value: str | None) -> str | None:
        if value and not services.is_valid_timezone(value):
            raise serializers.ValidationError(f"'{value}' is not a valid IANA timezone.")
        return value


class DepartmentSerializer(serializers.ModelSerializer):
    campus_id = _fk(Campus, source="campus", required=False, allow_null=True)

    class Meta:
        model = Department
        fields = (
            "id", "name", "code", "department_type", "campus_id", "head_staff_id",
            "description", "is_active", "created_at", "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate_code(self, value: str) -> str:
        return _normalize_code(value)


class AcademicSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = AcademicSession
        fields = (
            "id", "name", "start_date", "end_date", "status", "is_current",
            "created_at", "updated_at",
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
        services.assert_no_session_overlap(
            start_date=start, end_date=end, exclude_id=getattr(self.instance, "pk", None)
        )
        return attrs


class SessionCloneSerializer(serializers.Serializer):
    """Input for ``POST /academic-sessions/{id}:clone`` — the new session's identity."""

    name = serializers.CharField(max_length=50)
    start_date = serializers.DateField()
    end_date = serializers.DateField()


class TermSerializer(serializers.ModelSerializer):
    academic_session_id = _fk(AcademicSession, source="academic_session")

    class Meta:
        model = Term
        fields = (
            "id", "academic_session_id", "name", "sequence", "start_date", "end_date",
            "created_at", "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        session = attrs.get("academic_session") or getattr(
            self.instance, "academic_session", None
        )
        start = attrs.get("start_date") or getattr(self.instance, "start_date", None)
        end = attrs.get("end_date") or getattr(self.instance, "end_date", None)
        if session is None:
            raise serializers.ValidationError({"academic_session_id": "This field is required."})
        if start is None or end is None:
            raise serializers.ValidationError(
                {"start_date": "Both start_date and end_date are required."}
            )

        services.assert_session_writable(session)
        services.assert_term_window(
            session=session,
            start_date=start,
            end_date=end,
            exclude_id=getattr(self.instance, "pk", None),
        )
        return attrs


class ClassSerializer(serializers.ModelSerializer):
    class Meta:
        model = Class
        fields = ("id", "name", "code", "level", "is_active", "created_at", "updated_at")
        read_only_fields = READ_ONLY_FIELDS

    def validate_code(self, value: str | None) -> str | None:
        return _normalize_code(value)

    def validate_level(self, value: int) -> int:
        if value < 1:
            raise serializers.ValidationError("level starts at 1; it orders the promotion ladder.")
        return value


class SectionSerializer(serializers.ModelSerializer):
    class_id = _fk(Class, source="school_class")
    campus_id = _fk(Campus, source="campus")

    class Meta:
        model = Section
        fields = (
            "id", "class_id", "campus_id", "name", "capacity", "class_teacher_staff_id",
            "room_id", "is_active", "created_at", "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate_capacity(self, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise serializers.ValidationError("capacity must be at least 1, or null for unlimited.")
        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        school_class = attrs.get("school_class") or getattr(self.instance, "school_class", None)
        campus = attrs.get("campus") or getattr(self.instance, "campus", None)

        if school_class is not None and not school_class.is_active:
            raise serializers.ValidationError(
                {"class_id": f"Class '{school_class.name}' is inactive."}
            )
        if campus is not None and not campus.is_active:
            raise serializers.ValidationError(
                {"campus_id": f"Campus '{campus.name}' is inactive."}
            )
        return attrs


class SubjectSerializer(serializers.ModelSerializer):
    department_id = _fk(Department, source="department", required=False, allow_null=True)

    class Meta:
        model = Subject
        fields = (
            "id", "name", "code", "subject_type", "department_id", "description",
            "is_active", "created_at", "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate_code(self, value: str) -> str:
        return _normalize_code(value)


class ClassSubjectSerializer(serializers.ModelSerializer):
    """Curriculum mapping: this class studies this subject in this session."""

    academic_session_id = _fk(AcademicSession, source="academic_session")
    class_id = _fk(Class, source="school_class")
    subject_id = _fk(Subject, source="subject")
    campus_id = _fk(Campus, source="campus", required=False, allow_null=True)

    class Meta:
        model = ClassSubject
        fields = (
            "id", "academic_session_id", "class_id", "subject_id", "campus_id",
            "is_elective", "elective_group", "weekly_periods", "syllabus_file_id",
            "term_plans", "notes", "created_at", "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate_weekly_periods(self, value: int) -> int:
        if value < 1:
            raise serializers.ValidationError("weekly_periods must be at least 1.")
        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        session = attrs.get("academic_session") or getattr(
            self.instance, "academic_session", None
        )
        if session is None:
            raise serializers.ValidationError({"academic_session_id": "This field is required."})
        services.assert_session_writable(session)

        is_elective = attrs.get("is_elective")
        if is_elective is None:
            is_elective = getattr(self.instance, "is_elective", False)
        group = attrs.get("elective_group") or getattr(self.instance, "elective_group", None)
        if is_elective and not group:
            raise serializers.ValidationError(
                {"elective_group": "Required for an elective mapping so options can be grouped."}
            )
        return attrs


class HouseSerializer(serializers.ModelSerializer):
    class Meta:
        model = House
        fields = (
            "id", "name", "code", "color", "motto", "house_master_staff_id",
            "is_active", "created_at", "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate_code(self, value: str | None) -> str | None:
        return _normalize_code(value)


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
