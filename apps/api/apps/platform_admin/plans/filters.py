"""`PlanFilterSet`: the plan catalog's filters. Free text is `?search=` (name, code)."""

from __future__ import annotations

import django_filters

from apps.platform_admin.models import Plan


class PlanFilterSet(django_filters.FilterSet):
    class Meta:
        model = Plan
        fields = ["is_active", "billing_period", "currency"]
