"""Whitelisted filters for `/school-events` (module doc §16)."""

from __future__ import annotations

import django_filters

from apps.website_cms.models import ContentStatus, SchoolEvent


class SchoolEventFilterSet(django_filters.FilterSet):
    status = django_filters.ChoiceFilter(choices=ContentStatus.choices)
    starts_after = django_filters.IsoDateTimeFilter(field_name="starts_at", lookup_expr="gte")
    starts_before = django_filters.IsoDateTimeFilter(field_name="starts_at", lookup_expr="lte")

    class Meta:
        model = SchoolEvent
        fields = ["status"]
