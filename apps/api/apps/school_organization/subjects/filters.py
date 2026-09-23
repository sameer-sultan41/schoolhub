"""`SubjectFilterSet` — `/subjects` query filters (module doc §16)."""

from __future__ import annotations

import django_filters

from apps.school_organization.models import Subject


class SubjectFilterSet(django_filters.FilterSet):
    department_id = django_filters.UUIDFilter(field_name="department_id")

    class Meta:
        model = Subject
        fields = ["department_id", "subject_type", "is_active"]
