"""Filter set for the student-management module.

Every filterable field is listed explicitly — see school_organization/filters.py
for why. Filter names match the module doc §16.

``academic_session_id``, ``class_id`` and ``section_id`` are enrollment
attributes and are added once ``student_enrollments`` exists in a later PR, with
a comment there explaining the join. Declaring them now against a table that
does not exist would either silently match nothing or need a placeholder — worse
than the gap being visible in the filter set itself.
"""

from __future__ import annotations

import django_filters

from apps.student_management.models import Student


class StudentFilterSet(django_filters.FilterSet):
    campus_id = django_filters.UUIDFilter(field_name="campus_id")
    house_id = django_filters.UUIDFilter(field_name="house_id")

    class Meta:
        model = Student
        fields = ["campus_id", "house_id", "status"]
