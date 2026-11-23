"""`TenantFilterSet`: the console tenant list's filters. Free text is `?search=`."""

from __future__ import annotations

import django_filters

from core.tenancy.models import Tenant


class TenantFilterSet(django_filters.FilterSet):
    class Meta:
        model = Tenant
        fields = ["status", "current_plan", "subscription_status"]
