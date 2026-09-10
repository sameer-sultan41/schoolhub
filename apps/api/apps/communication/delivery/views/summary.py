"""`delivery/views/summary.py` — the `:summary` action mixin."""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework.request import Request
from rest_framework.response import Response

from apps.communication.action_mixin import ActionMixinBase
from apps.communication.delivery.serializers import DeliveryReportResponseSerializer
from apps.communication.delivery.services import report
from core.api.exceptions import DomainRuleViolation


class SummaryActionMixin(ActionMixinBase):
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
