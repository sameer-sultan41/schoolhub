"""`GET /subscription`: a school's own billing state, for its owner (platform-admin.md §16).

A tenant route, not a console one: the caller's own school is bound as on any tenant
endpoint, so the RLS-bound subscription row it reads is only ever its own. It is ungated by
any module flag: a school whose plan lacks a module still needs to see which plan it is on.
"""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.platform_admin.subscriptions import services
from apps.platform_admin.subscriptions.serializers import SubscriptionStateSerializer
from core.api.permissions import RequiresModuleFeature
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.rbac.permissions import HasPermissionKey


class SchoolSubscriptionView(TenantScopedViewSetMixin, APIView):
    """The school's plan, subscription status, trial end and limits.

    Mixes in ``TenantScopedViewSetMixin`` for its tenant binding only, as
    `SchoolSettingsView` does: it sets ``request.tenant`` from the caller's token.
    """

    permission_classes = [IsAuthenticated, RequiresModuleFeature, HasPermissionKey]
    required_feature = None
    required_permission = "school.subscription.view"
    serializer_class = SubscriptionStateSerializer

    @extend_schema(
        summary="This school's own subscription and limits",
        responses={200: SubscriptionStateSerializer},
    )
    def get(self, request: Request) -> Response:
        state = services.describe(request.tenant)
        return ActionResponse.ok(SubscriptionStateSerializer(state).data)
