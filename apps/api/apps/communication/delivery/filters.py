"""Query filters for `/delivery-logs`."""

from __future__ import annotations

import django_filters

from core.notifications.models import DeliveryLog


class DeliveryLogFilterSet(django_filters.FilterSet):
    channel = django_filters.CharFilter(field_name="channel", lookup_expr="exact")
    status = django_filters.CharFilter(field_name="status", lookup_expr="exact")
    notification_id = django_filters.UUIDFilter(field_name="notification_id")
    provider = django_filters.CharFilter(field_name="provider", lookup_expr="exact")
    created_at__gte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")

    class Meta:
        model = DeliveryLog
        fields: list[str] = []
