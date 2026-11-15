"""`/seo-settings?target_type=&target_id=`: one row per target. `GET` never writes."""

from __future__ import annotations

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from apps.website_cms.seo import services
from apps.website_cms.seo.serializers import SeoSettingSerializer, SeoTargetQuerySerializer
from apps.website_cms.views import FEATURE, STAFF_PERMISSIONS
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit

READ_KEY = "website.page.view"
_PARAMS = [
    OpenApiParameter("target_type", str, required=True),
    OpenApiParameter("target_id", str, required=False),
]


class SeoSettingView(TenantScopedViewSetMixin, APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = STAFF_PERMISSIONS
    required_feature = FEATURE
    required_permission = READ_KEY
    required_permission_map = {"patch": "website.seo.update"}
    scope_campus_field = None
    serializer_class = SeoSettingSerializer

    @staticmethod
    def _target(request) -> tuple[str, object]:
        query = SeoTargetQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        return query.validated_data["target_type"], query.validated_data.get("target_id")

    @extend_schema(parameters=_PARAMS, responses={200: SeoSettingSerializer})
    def get(self, request) -> Response:
        row = services.get_or_default(*self._target(request))
        return ActionResponse.ok(SeoSettingSerializer(row).data)

    @extend_schema(
        parameters=_PARAMS, request=SeoSettingSerializer, responses={200: SeoSettingSerializer}
    )
    def patch(self, request) -> Response:
        target_type, target_id = self._target(request)
        serializer = SeoSettingSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        row, before, changed = services.upsert(
            request.tenant, target_type, target_id, serializer.validated_data, request.user.pk
        )
        if changed:
            record_audit(
                request,
                "update",
                row,
                before=before,
                after={name: getattr(row, name) for name in before},
            )
        return ActionResponse.ok(SeoSettingSerializer(row).data, message="SEO settings updated.")
