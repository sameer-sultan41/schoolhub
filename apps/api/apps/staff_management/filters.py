"""Filter set for the staff-management module.

Every filterable field is listed explicitly — see school_organization/filters.py
for why. Filter names match the module doc §16.
"""

from __future__ import annotations

import django_filters

from apps.staff_management.models import Staff


class StaffFilterSet(django_filters.FilterSet):
    campus_id = django_filters.UUIDFilter(field_name="campus_id")
    department_id = django_filters.UUIDFilter(field_name="department_id")
    designation_id = django_filters.UUIDFilter(field_name="designation_id")

    class Meta:
        model = Staff
        fields = [
            "campus_id",
            "department_id",
            "designation_id",
            "staff_type",
            "employment_status",
        ]
