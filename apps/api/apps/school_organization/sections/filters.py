"""`SectionFilterSet` — `/sections` query filters (module doc §16)."""

from __future__ import annotations

import django_filters

from apps.school_organization.models import Section


class SectionFilterSet(django_filters.FilterSet):
    campus_id = django_filters.UUIDFilter(field_name="campus_id")
    class_id = django_filters.UUIDFilter(field_name="school_class_id")

    class Meta:
        model = Section
        fields = ["campus_id", "class_id", "is_active"]
