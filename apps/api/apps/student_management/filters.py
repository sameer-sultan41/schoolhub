"""Filter set for the student-management module.

Every filterable field is listed explicitly — see school_organization/filters.py
for why. Filter names match the module doc §16.
"""

from __future__ import annotations

import django_filters

from apps.student_management.models import Student


class StudentFilterSet(django_filters.FilterSet):
    campus_id = django_filters.UUIDFilter(field_name="campus_id")
    house_id = django_filters.UUIDFilter(field_name="house_id")
    # Enrollment attributes, joined through student_enrollments (PR3).
    # distinct=True guards against a student with more than one qualifying
    # enrollment row (e.g. across sessions) surfacing more than once.
    academic_session_id = django_filters.UUIDFilter(
        field_name="enrollments__academic_session_id", distinct=True
    )
    class_id = django_filters.UUIDFilter(field_name="enrollments__school_class_id", distinct=True)
    section_id = django_filters.UUIDFilter(field_name="enrollments__section_id", distinct=True)

    class Meta:
        model = Student
        fields = [
            "campus_id",
            "house_id",
            "status",
            "academic_session_id",
            "class_id",
            "section_id",
        ]
