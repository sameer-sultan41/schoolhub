"""Query filters for `/message-threads`."""

from __future__ import annotations

import django_filters

from apps.communication.models import MessageThread


class MessageThreadFilterSet(django_filters.FilterSet):
    status = django_filters.CharFilter(field_name="status", lookup_expr="exact")
    thread_type = django_filters.CharFilter(field_name="thread_type", lookup_expr="exact")
    student_id = django_filters.UUIDFilter(field_name="student_id")

    class Meta:
        model = MessageThread
        fields: list[str] = []
