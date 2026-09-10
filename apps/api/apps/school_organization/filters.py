"""Filter sets for the school-organization module.

Every filterable field is listed explicitly rather than generated from the model:
an implicit ``fields = "__all__"`` turns any column added later into a public query
surface — including ones that leak information or index badly.

Filter names match the module doc §16 (``campus_id``, ``class_id``,
``academic_session_id``, ``is_active``); free-text ``search`` is handled by DRF's
SearchFilter via each viewset's ``search_fields``.
"""

from __future__ import annotations

import django_filters

from apps.school_organization.models import (
    House,
    Section,
    Subject,
)


class SectionFilterSet(django_filters.FilterSet):
    campus_id = django_filters.UUIDFilter(field_name="campus_id")
    class_id = django_filters.UUIDFilter(field_name="school_class_id")

    class Meta:
        model = Section
        fields = ["campus_id", "class_id", "is_active"]


class SubjectFilterSet(django_filters.FilterSet):
    department_id = django_filters.UUIDFilter(field_name="department_id")

    class Meta:
        model = Subject
        fields = ["department_id", "subject_type", "is_active"]


class HouseFilterSet(django_filters.FilterSet):
    class Meta:
        model = House
        fields = ["is_active"]
