"""`OnboardingView` — `GET/PATCH /onboarding` (platform-admin §16).

A tenant endpoint, not a console one: the school's own staff call it with tenant RBAC, so it is
mounted through `apps.platform_admin.tenant_urls`, never under `/platform/`. One file for the
singleton, as `school_settings/view.py`.
"""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.platform_admin.onboarding import services
from apps.platform_admin.onboarding.serializers import (
    OnboardingSerializer,
    OnboardingUpdateSerializer,
)
from core.api.permissions import RequiresModuleFeature
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit
from core.rbac.permissions import HasPermissionKey


class OnboardingView(TenantScopedViewSetMixin, APIView):
    """The school's setup checklist, computed from its own rows (§5.6).

    Gated on the school-settings keys and `module.school`, the module whose structure it
    walks. `TenantScopedViewSetMixin` is mixed in for its tenant binding only, as on
    `SchoolSettingsView`.
    """

    permission_classes = [IsAuthenticated, RequiresModuleFeature, HasPermissionKey]
    required_feature = "module.school"
    required_permission = "school.settings.view"
    required_permission_map = {"patch": "school.settings.update"}
    serializer_class = OnboardingSerializer

    @extend_schema(responses={200: OnboardingSerializer})
    def get(self, request) -> Response:
        return ActionResponse.ok(services.onboarding_progress(request.tenant))

    @extend_schema(request=OnboardingUpdateSerializer, responses={200: OnboardingSerializer})
    def patch(self, request) -> Response:
        serializer = OnboardingUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        settings_row, before, after = services.update_onboarding(
            tenant=request.tenant, actor_id=request.user.pk, **serializer.validated_data
        )
        record_audit(
            request,
            "update",
            settings_row,
            before={"onboarding": before},
            after={"onboarding": after},
        )
        return ActionResponse.ok(
            services.onboarding_progress(request.tenant), message="Setup progress updated."
        )
