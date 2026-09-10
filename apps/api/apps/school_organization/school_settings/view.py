"""`SchoolSettingsView` — `GET/PATCH /school-settings` (module doc §16).

No split into per-action files: a singleton resource has no distinct
actions the way `academic_sessions` does, so one file holds the whole
view — matching `communication/preferences/view.py`'s precedent for the
same shape of resource.
"""

from __future__ import annotations

from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.school_organization.school_settings.serializers import SchoolSettingsSerializer
from core.api.permissions import RequiresModuleFeature
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit
from core.rbac.permissions import HasPermissionKey
from core.tenancy.models import TenantSettings


class SchoolSettingsView(TenantScopedViewSetMixin, APIView):
    """Singleton school profile and academic configuration (module doc §16).

    A singleton rather than a collection because a tenant is one school; the
    branding/academic payloads live in ``tenant_settings`` JSONB while timezone,
    locale and currency stay on the tenant row, which is where the request
    middleware and every other module already read them from.

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
        return ActionResponse.ok(self._represent(request, self._settings(request)))

    @extend_schema(request=SchoolSettingsSerializer, responses={200: SchoolSettingsSerializer})
    def patch(self, request) -> Response:
        serializer = SchoolSettingsSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        changes = serializer.validated_data

        settings_row = self._settings(request)
        before = self._represent(request, settings_row)

        with transaction.atomic():
            for field in ("branding", "academic"):
                if field in changes:
                    setattr(settings_row, field, changes[field])
            settings_row.updated_by = request.user.pk
            settings_row.save()

            tenant = request.tenant
            tenant_fields = [f for f in ("timezone", "locale", "currency") if f in changes]
            for field in tenant_fields:
                setattr(tenant, field, changes[field])
            if tenant_fields:
                tenant.updated_by = request.user.pk
                tenant.save(update_fields=[*tenant_fields, "updated_by", "updated_at"])

        after = self._represent(request, settings_row)
        record_audit(request, "update", settings_row, before=before, after=after)
        return ActionResponse.ok(after, message="School settings updated.")

    @staticmethod
    def _settings(request) -> TenantSettings:
        """One settings row per tenant; provisioning may not have created it yet."""
        row, _ = TenantSettings.objects.get_or_create(
            tenant=request.tenant,
            defaults={"created_by": request.user.pk, "updated_by": request.user.pk},
        )
        return row

    @staticmethod
    def _represent(request, settings_row: TenantSettings) -> dict:
        tenant = request.tenant
        return {
            "branding": settings_row.branding,
            "academic": settings_row.academic,
            "timezone": tenant.timezone,
            "locale": tenant.locale,
            "currency": tenant.currency,
        }
