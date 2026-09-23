"""`HouseFilterSet` — `/houses` query filters (module doc §16)."""

from __future__ import annotations

import django_filters

from apps.school_organization.models import House


class HouseFilterSet(django_filters.FilterSet):
    class Meta:
        model = House
        fields = ["is_active"]
