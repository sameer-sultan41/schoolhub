"""`DepartmentFilterSet` — `/departments` query filters (module doc §16).

Every filterable field is listed explicitly rather than generated from the
model: an implicit ``fields = "__all__"`` turns any column added later into a
public query surface — including ones that leak information or index badly.
"""

from __future__ import annotations

import django_filters

from apps.school_organization.models import Department


class DepartmentFilterSet(django_filters.FilterSet):
    campus_id = django_filters.UUIDFilter(field_name="campus_id")

    class Meta:
        model = Department
        fields = ["campus_id", "department_type", "is_active"]
