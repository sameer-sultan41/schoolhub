"""`GET/PATCH /notification-preferences` — the caller's own channel matrix."""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.communication.permission_classes import FEATURE, OWN_PREFERENCE_PERMISSIONS
from apps.communication.preferences.serializers import (
    NotificationPreferenceRowSerializer,
    NotificationPreferenceUpdateSerializer,
)
from apps.communication.preferences.services.matrix import materialize_preference_matrix
from apps.communication.preferences.services.save import save_preferences
from core.api.viewsets import TenantScopedViewSetMixin


class NotificationPreferenceView(TenantScopedViewSetMixin, APIView):
    """`GET/PATCH /notification-preferences` — the caller's own channel matrix.

    No `pk` in the path: this always resolves to `request.user`. §4 grants the
    key to every tenant role at `own` scope, and "own" here means "the caller,
    always" — there is no other user's matrix this endpoint could address.

    `TenantScopedViewSetMixin` is mixed in for its `initial()`/`finalize_response()`
    tenant binding alone — a plain `APIView` never gets `request.tenant` under real
    JWT auth (only `TenantMiddleware`, session-only, and this mixin's `initial()`
    ever set it; see the mixin's own docstring). Without it every real request 403s:
    `RequiresModuleFeature` fails closed on `request.tenant is None`. The mixin's
    other methods (`get_queryset`, `perform_create`) are `GenericAPIView`-only and
    are never called here, so nothing else about mixing it into a bare `APIView`
    matters.
    """

    permission_classes = OWN_PREFERENCE_PERMISSIONS
    required_feature = FEATURE
    required_permission = "communication.notification-preference.update"

    @extend_schema(responses={200: NotificationPreferenceRowSerializer(many=True)})
    def get(self, request: Request) -> Response:
        matrix = materialize_preference_matrix(user_id=request.user.pk, tenant_id=request.tenant.pk)
        return Response(NotificationPreferenceRowSerializer(matrix, many=True).data)

    @extend_schema(
        request=NotificationPreferenceUpdateSerializer(many=True),
        responses={200: NotificationPreferenceRowSerializer(many=True)},
    )
    def patch(self, request: Request) -> Response:
        serializer = NotificationPreferenceUpdateSerializer(
            data=request.data if isinstance(request.data, list) else [request.data], many=True
        )
        serializer.is_valid(raise_exception=True)
        save_preferences(
            user_id=request.user.pk, tenant_id=request.tenant.pk, rows=serializer.validated_data
        )
        matrix = materialize_preference_matrix(user_id=request.user.pk, tenant_id=request.tenant.pk)
        return Response(NotificationPreferenceRowSerializer(matrix, many=True).data)
