"""Query filters for `/notifications`."""

from __future__ import annotations

import django_filters

from core.notifications.models import Notification, NotificationCategory


class NotificationFilterSet(django_filters.FilterSet):
    read = django_filters.BooleanFilter(
        method="filter_read", help_text="true = read, false = unread."
    )
    category = django_filters.ChoiceFilter(choices=NotificationCategory.choices)

    class Meta:
        model = Notification
        fields: list[str] = []

    def filter_read(self, queryset, name, value):
        return queryset.filter(read_at__isnull=not value)
