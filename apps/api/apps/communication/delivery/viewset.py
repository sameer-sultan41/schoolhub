"""`DeliveryLogViewSet` — request handling for `/delivery-logs`.

Thin: every rule lives in `services/report.py`. See `notices/viewset.py`'s
own docstring for why actions stay as plain methods on this one class
rather than a further mixin-per-action split.
"""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.request import Request
from rest_framework.response import Response

from apps.communication.delivery.filters import DeliveryLogFilterSet
from apps.communication.delivery.serializers import (
    DeliveryLogSerializer,
    DeliveryReportResponseSerializer,
)
from apps.communication.delivery.services import report
from apps.communication.permission_classes import FEATURE, STAFF_PERMISSIONS
from core.api.exceptions import DomainRuleViolation
from core.api.viewsets import TenantScopedViewSetMixin
from core.notifications.models import DeliveryLog


class DeliveryLogViewSet(
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

    @extend_schema(responses={200: DeliveryReportResponseSerializer})
    def summary(self, request: Request) -> Response:
        """`GET /delivery-logs:summary?group_by=channel|status|provider` — §13's delivery report."""
        group_by = request.query_params.get("group_by", "channel")
        if group_by not in report.GROUP_BY_FIELDS:
            raise DomainRuleViolation(
                f"group_by must be one of {sorted(report.GROUP_BY_FIELDS)}.",
                meta={"group_by": group_by},
            )
        rows = report.delivery_report(self.filter_queryset(self.get_queryset()), group_by=group_by)
        return Response({"data": rows})
