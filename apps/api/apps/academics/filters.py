"""Whitelisted filters — academics.md §16 names the fields each list accepts.

**Every foreign key is an explicit `UUIDFilter`, never a `Meta.fields` entry.**
Declaring `fields = {"academic_session_id": ["exact"]}` against an FK makes
django-filter generate a `ModelChoiceFilter`, and that changes the behaviour in
two ways that both matter:

- it *validates* the id against the related model and answers **400 "Select a
  valid choice"** for anything it cannot resolve, where a filter naming an id
  the caller cannot see should simply match nothing — a filter narrows a list,
  it does not assert that the value exists;
- it costs an extra query per filtered request to do that validation.

`student_management/filters.py` already does it this way; academics was the
outlier, and its own cross-tenant test caught it.
"""

from __future__ import annotations

import django_filters

from apps.academics.models import StudentPromotion, TeacherSubjectAllocation
from apps.school_organization.models import ClassSubject


class CurriculumFilterSet(django_filters.FilterSet):
    academic_session_id = django_filters.UUIDFilter(field_name="academic_session_id")
    # §16 spells this `class_id`; the model field is `school_class` because
    # `class` is a Python keyword.
    class_id = django_filters.UUIDFilter(field_name="school_class_id")
    subject_id = django_filters.UUIDFilter(field_name="subject_id")
    campus_id = django_filters.UUIDFilter(field_name="campus_id")

    class Meta:
        model = ClassSubject
        fields = {
            "is_elective": ["exact"],
            "elective_group": ["exact"],
        }


class TeacherAllocationFilterSet(django_filters.FilterSet):
    academic_session_id = django_filters.UUIDFilter(field_name="academic_session_id")
    section_id = django_filters.UUIDFilter(field_name="section_id")
    subject_id = django_filters.UUIDFilter(field_name="subject_id")
    staff_id = django_filters.UUIDFilter(field_name="staff_id")

    class Meta:
        model = TeacherSubjectAllocation
        fields = {
            "is_primary": ["exact"],
        }


class PromotionFilterSet(django_filters.FilterSet):
    student_id = django_filters.UUIDFilter(field_name="student_id")
    from_academic_session_id = django_filters.UUIDFilter(field_name="from_academic_session_id")
    to_academic_session_id = django_filters.UUIDFilter(field_name="to_academic_session_id")
    from_class_id = django_filters.UUIDFilter(field_name="from_class_id")

    class Meta:
        model = StudentPromotion
        fields = {
            # `batch_id` is a bare UUID column, not an FK — there is no batch
            # table (the entity doc settles that), so it was never at risk of
            # becoming a ModelChoiceFilter.
            "batch_id": ["exact"],
            "status": ["exact"],
            "decision": ["exact"],
        }
