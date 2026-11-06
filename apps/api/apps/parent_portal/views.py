"""`GET /parent-portal/dashboard` — the portal's landing summary in one call."""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.parent_portal import services
from apps.parent_portal.features import FEATURE
from apps.parent_portal.permissions import DASHBOARD_VIEW
from apps.parent_portal.serializers import PortalDashboardSerializer
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin


class DashboardView(TenantScopedViewSetMixin, APIView):
    """Per-child summary cards plus the caller's unread counts.

    The base permission stack (authenticated, module on, key held). Staff holding
    the key are not refused: they simply own no children, so the list is empty.
    Every card is read through its owning module's own visibility function.
    """

    required_feature = FEATURE
    required_permission = DASHBOARD_VIEW
    serializer_class = PortalDashboardSerializer

    @extend_schema(
        summary="The parent portal dashboard", responses={200: PortalDashboardSerializer}
    )
    def get(self, request: Request) -> Response:
        summary = services.build_dashboard(user=request.user, today=request.tenant.local_date())
        return ActionResponse.ok(PortalDashboardSerializer(summary).data)
