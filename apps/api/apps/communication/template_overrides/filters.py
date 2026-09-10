"""Query filters for `/notification-templates`."""

from __future__ import annotations

import django_filters

from apps.communication.models import NotificationTemplateOverride


class NotificationTemplateOverrideFilterSet(django_filters.FilterSet):
    code = django_filters.CharFilter(field_name="code", lookup_expr="exact")
    channel = django_filters.CharFilter(field_name="channel", lookup_expr="exact")
    is_active = django_filters.BooleanFilter(field_name="is_active")
    is_system = django_filters.BooleanFilter(field_name="is_system")

    class Meta:
        model = NotificationTemplateOverride
        fields: list[str] = []
