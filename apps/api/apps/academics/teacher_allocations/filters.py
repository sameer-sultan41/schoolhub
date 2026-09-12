"""`?ordering=`/`?<field>=` filters for `/teacher-subject-allocations`.

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

from apps.academics.models import TeacherSubjectAllocation


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
