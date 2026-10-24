"""Serializers for `teacher_subject_allocations` — academics.md §5.3, §16.

Shape follows the root `apps.academics.serializers` module this was cut from:
FKs are exposed with an `_id` suffix over the tenant-scoped default manager (so
a foreign-tenant id fails to resolve and yields a 400 rather than leaking), an
explicit `fields` tuple, and the id and timestamps read-only (`effective_to` takes a
value on PATCH only; create accepts just a null).
"""

from __future__ import annotations

from rest_framework import serializers

from apps.academics.models import TeacherSubjectAllocation
from apps.academics.serializers import READ_ONLY_FIELDS, _fk
from apps.academics.teacher_allocations import dates
from apps.school_organization.models import AcademicSession, Section, Subject
from apps.staff_management.models import Staff
from core.api.exceptions import DomainRuleViolation


class TeacherAllocationSerializer(serializers.ModelSerializer):
    academic_session_id = _fk(AcademicSession, source="academic_session")
    section_id = _fk(Section, source="section")
    subject_id = _fk(Subject, source="subject")
    staff_id = _fk(Staff, source="staff")
    # Read-only names, each with an explicit `source=`: `get_queryset` annotates
    # `section_name`/`subject_name`, which the instances create and PATCH return lack.
    class_id = serializers.UUIDField(source="section.school_class_id", read_only=True)
    class_name = serializers.CharField(source="section.school_class.name", read_only=True)
    section_name = serializers.CharField(source="section.name", read_only=True)
    subject_name = serializers.CharField(source="subject.name", read_only=True)
    staff_name = serializers.SerializerMethodField()

    class Meta:
        model = TeacherSubjectAllocation
        fields = (
            "id",
            "academic_session_id",
            "section_id",
            "subject_id",
            "staff_id",
            "is_primary",
            "weekly_periods",
            "effective_from",
            "effective_to",
            "class_id",
            "class_name",
            "section_name",
            "subject_name",
            "staff_name",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def get_staff_name(self, obj: TeacherSubjectAllocation) -> str:
        return obj.staff.full_name

    def validate_weekly_periods(self, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise serializers.ValidationError("Weekly periods must be at least 1.")
        return value

    def validate(self, attrs: dict) -> dict:
        """`effective_to` takes a value on PATCH only, and its rules surface as a 400 field error.

        The service repeats the end-date check as a backstop for non-API callers.
        """
        if self.instance is None:
            # The generated POST schema lists `effective_to` (nullable), so a null is a no-op.
            if attrs.get("effective_to") is not None:
                raise serializers.ValidationError(
                    {"effective_to": "An allocation cannot be created already ended."}
                )
            return attrs

        try:
            dates.assert_patch_dates_valid(
                changes=attrs,
                current_from=self.instance.effective_from,
                current_to=self.instance.effective_to,
            )
        except DomainRuleViolation as exc:
            raise serializers.ValidationError(exc.detail) from exc
        return attrs


class LoadSummaryQuerySerializer(serializers.Serializer):
    """The `load-summary` query string — a malformed id is a client error, not a 500."""

    academic_session_id = serializers.UUIDField()


class TeacherLoadRowSerializer(serializers.Serializer):
    """One teacher's row in `load-summary`: current load against the norm."""

    staff_id = serializers.UUIDField()
    name = serializers.CharField()
    weekly_periods = serializers.IntegerField()
    allocations = serializers.IntegerField()
    norm = serializers.IntegerField()
    over_norm = serializers.BooleanField()
