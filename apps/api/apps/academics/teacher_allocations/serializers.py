"""Serializer for `teacher_subject_allocations` — academics.md §5.3, §16.

Shape follows the root `apps.academics.serializers` module this was cut from:
FKs are exposed with an `_id` suffix over the tenant-scoped default manager (so
a foreign-tenant id fails to resolve and yields a 400 rather than leaking), an
explicit `fields` tuple, and lifecycle fields read-only because they move only
through colon-actions.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.academics.models import TeacherSubjectAllocation
from apps.academics.serializers import READ_ONLY_FIELDS, _fk
from apps.school_organization.models import AcademicSession, Section, Subject
from apps.staff_management.models import Staff


class TeacherAllocationSerializer(serializers.ModelSerializer):
    academic_session_id = _fk(AcademicSession, source="academic_session")
    section_id = _fk(Section, source="section")
    subject_id = _fk(Subject, source="subject")
    staff_id = _fk(Staff, source="staff")

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
            "created_at",
            "updated_at",
        )
        # `effective_to` is set by PATCH, never on create: an allocation that
        # arrives already ended is not a thing, and `create_allocation` would
        # have dropped the value silently.
        read_only_fields = (*READ_ONLY_FIELDS, "effective_to")

    def validate_weekly_periods(self, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise serializers.ValidationError("Weekly periods must be at least 1.")
        return value
