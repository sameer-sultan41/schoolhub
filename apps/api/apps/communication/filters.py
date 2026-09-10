"""Query filters for the communication module.

Every FK/relation filter is an explicit typed filter, never a `Meta.fields`
entry — `timetable/filters.py`'s documented reasoning (a `ModelChoiceFilter`
builds its validation queryset with no tenant bound, and under RLS that answers
400 for the caller's own ids) holds identically here.
"""

from __future__ import annotations

import django_filters

from apps.communication.models import Announcement, Notice, NotificationTemplateOverride
from core.notifications.models import DeliveryLog


class NotificationTemplateOverrideFilterSet(django_filters.FilterSet):
    code = django_filters.CharFilter(field_name="code", lookup_expr="exact")
    channel = django_filters.CharFilter(field_name="channel", lookup_expr="exact")
    is_active = django_filters.BooleanFilter(field_name="is_active")
    is_system = django_filters.BooleanFilter(field_name="is_system")

    class Meta:
        model = NotificationTemplateOverride
        fields: list[str] = []


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


class AnnouncementFilterSet(django_filters.FilterSet):
    status = django_filters.CharFilter(field_name="status", lookup_expr="exact")
    audience_type = django_filters.CharFilter(field_name="audience_type", lookup_expr="exact")
    campus_id = django_filters.UUIDFilter(field_name="campus_id")
    is_emergency = django_filters.BooleanFilter(field_name="is_emergency")
    show_on_website = django_filters.BooleanFilter(field_name="show_on_website")

    class Meta:
        model = Announcement
        fields: list[str] = []


class NoticeFilterSet(django_filters.FilterSet):
    status = django_filters.CharFilter(field_name="status", lookup_expr="exact")
    notice_type = django_filters.CharFilter(field_name="notice_type", lookup_expr="exact")
    audience_type = django_filters.CharFilter(field_name="audience_type", lookup_expr="exact")
    requires_acknowledgment = django_filters.BooleanFilter(field_name="requires_acknowledgment")

    class Meta:
        model = Notice
        fields: list[str] = []
