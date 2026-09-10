"""Assembles `DeliveryLogViewSet` from its per-action mixins under `views/` —
same composition mechanism as `notices.viewset.NoticeViewSet`.
"""

from __future__ import annotations

from rest_framework import mixins, viewsets

from apps.communication.delivery.filters import DeliveryLogFilterSet
from apps.communication.delivery.serializers import DeliveryLogSerializer
from apps.communication.delivery.views.summary import SummaryActionMixin
from apps.communication.permission_classes import FEATURE, STAFF_PERMISSIONS
from core.api.viewsets import TenantScopedViewSetMixin
from core.notifications.models import DeliveryLog


class DeliveryLogViewSet(
    SummaryActionMixin,
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """`/delivery-logs` — the delivery dashboard, read-only.

    List/retrieve only: nothing here should let a caller edit delivery
    history, and every write to this table already happens inside
    `core.notifications` (`notify()`, `deliver_notifications`).
    """

    permission_classes = STAFF_PERMISSIONS
    queryset = DeliveryLog.objects
    serializer_class = DeliveryLogSerializer
    filterset_class = DeliveryLogFilterSet
    ordering_fields = ["created_at", "last_attempt_at"]
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = "communication.delivery-log.view"
    required_permission_map = {"summary": "communication.delivery-log.view"}
    http_method_names = ["get", "head", "options"]
