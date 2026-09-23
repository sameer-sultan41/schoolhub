"""Query filters for `/notices`."""

from __future__ import annotations

import django_filters

from apps.communication.models import Notice


class NoticeFilterSet(django_filters.FilterSet):
    status = django_filters.CharFilter(field_name="status", lookup_expr="exact")
    notice_type = django_filters.CharFilter(field_name="notice_type", lookup_expr="exact")
    audience_type = django_filters.CharFilter(field_name="audience_type", lookup_expr="exact")
    requires_acknowledgment = django_filters.BooleanFilter(field_name="requires_acknowledgment")

    class Meta:
        model = Notice
        fields: list[str] = []
