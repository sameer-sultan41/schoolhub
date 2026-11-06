"""Query filters for `/message-thread-oversight`."""

from __future__ import annotations

import django_filters

from apps.communication.threads.filters import MessageThreadFilterSet


class ThreadOversightFilterSet(MessageThreadFilterSet):
    """The inbox filters, plus the staff member a thread is routed to."""

    assigned_to = django_filters.UUIDFilter(field_name="assigned_to_id")

    class Meta(MessageThreadFilterSet.Meta):
        fields: list[str] = []
