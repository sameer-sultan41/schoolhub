"""`/platform/feature-flags` and `/platform/tenants/{tenant_pk}/feature-overrides` (§16).

Flags are platform rows and bind no school. A school's overrides are under RLS, so their
route is nested under the school and binds it for the whole request
(`PlatformTenantNestedMixin`): another school's override is a 404 there.
"""

from __future__ import annotations

from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import mixins
from rest_framework.request import Request
from rest_framework.response import Response

from apps.platform_admin.flags import services
from apps.platform_admin.flags.serializers import (
    FeatureFlagSerializer,
    FeatureFlagUpdateSerializer,
    TenantFeatureOverrideCreateSerializer,
    TenantFeatureOverrideSerializer,
)
from core.api.pagination import PageNumberPagination
from core.api.platform import PlatformTenantNestedMixin, PlatformViewSet
from core.api.viewsets import ActionResponse
from core.audit.services import record_audit
from core.tenancy.models import FeatureFlag, TenantFeatureOverride

_VIEW = "platform.feature-flag.view"
_UPDATE = "platform.feature-flag.update"
_REFUSED = OpenApiResponse(
    description="toggle_refused: the school still needs this flag, or the override would "
    "switch a kill switch on."
)


class FeatureFlagViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, PlatformViewSet):
    """`GET /platform/feature-flags`, `GET/PATCH /platform/feature-flags/{id}`."""

    queryset = FeatureFlag.objects.all()
    serializer_class = FeatureFlagSerializer
    search_fields = ["key", "description"]
    pagination_class = PageNumberPagination
    ordering = ["key"]
    ordering_fields = ["key", "updated_at"]
    required_permission = _VIEW
    required_permission_map = {"partial_update": _UPDATE}
    http_method_names = ["get", "patch", "head", "options"]

    @extend_schema(
        summary="Set a flag's platform default or kill switch, for every school at once",
        request=FeatureFlagUpdateSerializer,
        responses={200: FeatureFlagSerializer},
    )
    def partial_update(self, request: Request, pk=None) -> Response:
        flag = self.get_object()
        payload = FeatureFlagUpdateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        before = FeatureFlagSerializer(flag).data
        flag = services.update_flag(flag, data=payload.validated_data)
        after = FeatureFlagSerializer(flag).data
        record_audit(request, "update", flag, before=before, after=after)
        return ActionResponse.ok(after, message="Feature flag updated.")


class TenantFeatureOverrideViewSet(
    PlatformTenantNestedMixin, mixins.ListModelMixin, PlatformViewSet
):
    """`GET/POST .../tenants/{tenant_pk}/feature-overrides`, `DELETE .../{id}`."""

    # The manager, not a queryset: it filters to the school bound at request time.
    queryset = TenantFeatureOverride.objects
    serializer_class = TenantFeatureOverrideSerializer
    # One row per flag at most: a short, bounded list.
    pagination_class = None
    ordering = ["feature_flag__key"]
    required_permission = _VIEW
    required_permission_map = {"create": _UPDATE, "destroy": _UPDATE}
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        return super().get_queryset().filter(deleted_at__isnull=True).select_related("feature_flag")

    @extend_schema(
        summary="Override a flag for this school, replacing any override it has",
        request=TenantFeatureOverrideCreateSerializer,
        responses={201: TenantFeatureOverrideSerializer, 409: _REFUSED},
    )
    def create(self, request: Request, tenant_pk=None) -> Response:
        payload = TenantFeatureOverrideCreateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        override = services.set_override(
            request.tenant,
            data["flag"],
            enabled=data["enabled"],
            reason=data["reason"],
            expires_at=data.get("expires_at"),
            actor_id=request.user.pk,
        )
        after = TenantFeatureOverrideSerializer(override).data
        record_audit(request, "create", override, after=after)
        return ActionResponse.ok(after, message="Override saved.", status=201)

    @extend_schema(
        summary="Remove this school's override; the plan or the default decides again",
        responses={204: None, 409: _REFUSED},
    )
    def destroy(self, request: Request, tenant_pk=None, pk=None) -> Response:
        override = self.get_object()
        before = TenantFeatureOverrideSerializer(override).data
        services.remove_override(override, actor_id=request.user.pk)
        record_audit(request, "delete", override, before=before)
        return Response(status=204)
