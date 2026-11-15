"""`SchoolSettingsView` — `GET/PATCH /school-settings` (module doc §16).

No split into per-action files: a singleton resource has no distinct
actions the way `academic_sessions` does, so one file holds the whole
view — the same shape `apps/communication`'s `preferences/view.py` uses
for its own singleton resource (PR #73, adopting the same file-per-action
layout independently). The write itself is `services.update_school_settings`.
"""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.school_organization.school_settings import services
from apps.school_organization.school_settings.serializers import (
    SchoolSettingsSerializer,
    SchoolSettingsUpdateSerializer,
)
from apps.school_organization.tenant_settings import get_settings_row
from core.api.permissions import RequiresModuleFeature
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit
from core.rbac.permissions import HasPermissionKey
from core.tenancy.models import TenantSettings


class SchoolSettingsView(TenantScopedViewSetMixin, APIView):
    """Singleton school profile and academic configuration (module doc §16).

    A singleton rather than a collection because a tenant is one school. `name`,
    timezone, locale and currency stay on the tenant row, which is where the request
    middleware and every other module already read them from; the logo, branding and
    academic payloads live on ``tenant_settings``.

    `Tenant.name` has a second writer, the platform console's tenant PATCH: the last write
    wins and both are audited (school-organization §20).

    Mixes in ``TenantScopedViewSetMixin`` purely for its ``initial()``/
    ``finalize_response()`` tenant binding — this is a plain ``APIView``, not a
    viewset, so the mixin's queryset/create/update helpers are never called and
    are harmless dead code here. Without this, ``request.tenant`` is never set
    (only viewsets get it, via that same mixin), so ``RequiresModuleFeature``
    fails closed on every request before ``is_feature_enabled`` is even checked.
    """

    permission_classes = [IsAuthenticated, RequiresModuleFeature, HasPermissionKey]
    required_feature = "module.school"
    required_permission = "school.settings.view"
    required_permission_map = {"patch": "school.settings.update"}
    serializer_class = SchoolSettingsSerializer

    @extend_schema(responses={200: SchoolSettingsSerializer})
    def get(self, request) -> Response:
        return ActionResponse.ok(self._response(request, get_settings_row(request)))

    @extend_schema(
        request=SchoolSettingsUpdateSerializer, responses={200: SchoolSettingsSerializer}
    )
    def patch(self, request) -> Response:
        serializer = SchoolSettingsUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        settings_row = get_settings_row(request)
        before = services.represent(request.tenant, settings_row)
        services.update_school_settings(
            tenant=request.tenant,
            settings_row=settings_row,
            changes=serializer.validated_data,
            actor_id=request.user.pk,
        )
        after = services.represent(request.tenant, settings_row)
        record_audit(request, "update", settings_row, before=before, after=after)
        return ActionResponse.ok(
            self._response(request, settings_row), message="School settings updated."
        )

    @staticmethod
    def _response(request, settings_row: TenantSettings) -> dict:
        return {
            **services.represent(request.tenant, settings_row),
            "logo_url": services.logo_url(settings_row),
        }
