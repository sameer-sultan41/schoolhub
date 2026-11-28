"""`/platform/tenants/{tenant_pk}/usage` and `:refresh-usage`: one school's usage (§16).

Nested under the school and bound to it (`PlatformTenantNestedMixin`): `:refresh-usage`
counts that school's own rows, and the limits read its live subscription. The GET reads the
latest snapshot, a platform table.
"""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework.request import Request
from rest_framework.response import Response

from apps.platform_admin.models import TenantUsageSnapshot
from apps.platform_admin.subscriptions.services import effective_limits
from apps.platform_admin.usage import services
from apps.platform_admin.usage.serializers import TenantUsageSerializer
from core.api.platform import PlatformTenantNestedMixin, PlatformViewSet
from core.api.viewsets import ActionResponse

_VIEW = "platform.tenant.view"


class TenantUsageViewSet(PlatformTenantNestedMixin, PlatformViewSet):
    """`GET .../tenants/{tenant_pk}/usage` and `POST .../tenants/{tenant_pk}:refresh-usage`."""

    serializer_class = TenantUsageSerializer
    required_permission = _VIEW
    # Taking a snapshot changes no school data and only appends a metrics row, so whoever may
    # read usage may refresh it (platform-admin.md §4, `platform_support` included).
    required_permission_map = {"refresh_usage": _VIEW}
    http_method_names = ["get", "post", "head", "options"]

    @extend_schema(summary="A school's latest usage snapshot and its effective limits")
    def retrieve(self, request: Request, tenant_pk=None) -> Response:
        return Response(self._usage(request, services.latest_snapshot(request.tenant.pk)))

    @extend_schema(
        summary="Take a usage snapshot of the school now",
        request=None,
        responses={200: TenantUsageSerializer},
    )
    def refresh_usage(self, request: Request, tenant_pk=None) -> Response:
        snapshot = services.snapshot_tenant(request.tenant.pk)
        return ActionResponse.ok(self._usage(request, snapshot), message="Usage refreshed.")

    @staticmethod
    def _usage(request: Request, snapshot: TenantUsageSnapshot | None) -> dict:
        return TenantUsageSerializer(
            {"snapshot": snapshot, "limits": effective_limits(request.tenant.pk)}
        ).data
