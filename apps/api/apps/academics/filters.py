"""Whitelisted filters — academics.md §16 names the fields each list accepts."""

from __future__ import annotations

import django_filters

from apps.academics.models import StudentPromotion, TeacherSubjectAllocation
from apps.school_organization.models import ClassSubject


class CurriculumFilterSet(django_filters.FilterSet):
    # §16 spells this `class_id`; the model field is `school_class` because
    # `class` is a Python keyword.
    class_id = django_filters.UUIDFilter(field_name="school_class_id")

    class Meta:
        model = ClassSubject
        fields = {
            "academic_session_id": ["exact"],
            "subject_id": ["exact"],
            "campus_id": ["exact"],
            "is_elective": ["exact"],
            "elective_group": ["exact"],
        }


class TeacherAllocationFilterSet(django_filters.FilterSet):
    class Meta:
        model = TeacherSubjectAllocation
        fields = {
            "academic_session_id": ["exact"],
            "section_id": ["exact"],
            "subject_id": ["exact"],
            "staff_id": ["exact"],
            "is_primary": ["exact"],
        }


class PromotionFilterSet(django_filters.FilterSet):
    class Meta:
        model = StudentPromotion
        fields = {
            "batch_id": ["exact"],
            "student_id": ["exact"],
            "from_academic_session_id": ["exact"],
            "to_academic_session_id": ["exact"],
            "from_class_id": ["exact"],
            "status": ["exact"],
            "decision": ["exact"],
        }
