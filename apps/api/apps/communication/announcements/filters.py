"""Query filters for `/announcements`."""

from __future__ import annotations

import django_filters

from apps.communication.models import Announcement


class AnnouncementFilterSet(django_filters.FilterSet):
    status = django_filters.CharFilter(field_name="status", lookup_expr="exact")
    audience_type = django_filters.CharFilter(field_name="audience_type", lookup_expr="exact")
    campus_id = django_filters.UUIDFilter(field_name="campus_id")
    is_emergency = django_filters.BooleanFilter(field_name="is_emergency")
    show_on_website = django_filters.BooleanFilter(field_name="show_on_website")

    class Meta:
        model = Announcement
        fields: list[str] = []
