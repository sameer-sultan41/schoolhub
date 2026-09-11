"""`ClassFilterSet` — `/classes` query filters (module doc §16)."""

from __future__ import annotations

import django_filters

from apps.school_organization.models import Class


class ClassFilterSet(django_filters.FilterSet):
    class Meta:
        model = Class
        fields = ["is_active", "level"]
