"""`?ordering=`/`?<field>=` filters for `/teacher-substitutions`."""

from __future__ import annotations

import django_filters

from apps.timetable.models import TeacherSubstitution


class TeacherSubstitutionFilterSet(django_filters.FilterSet):
    substitute_staff_id = django_filters.UUIDFilter(field_name="substitute_staff_id")
    absent_staff_id = django_filters.UUIDFilter(field_name="absent_staff_id")

    class Meta:
        model = TeacherSubstitution
        fields = {
            # `gte`/`lte` as well as `exact`: §13's substitution report is a date
            # range, and the vice principal's morning list is a single day.
            "date": ["exact", "gte", "lte"],
            "status": ["exact"],
        }
