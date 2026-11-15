"""`WebsiteSettingsView` (`/website-settings`) and `ThemeViewSet` (`/themes`).

`/website-settings` is a singleton `APIView`, so it declares JWT-only authentication itself
(agent-lessons L63) and mixes in `TenantScopedViewSetMixin` for the tenant binding, as
`school_settings` does.
"""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from apps.website_cms.models import Theme, WebsiteSettings
from apps.website_cms.revalidation import host_tag, queue_revalidation
from apps.website_cms.settings import services
from apps.website_cms.settings.serializers import ThemeSerializer, WebsiteSettingsSerializer
from apps.website_cms.views import FEATURE, STAFF_PERMISSIONS
from core.api.pagination import PageNumberPagination
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit

READ_KEY = "website.page.view"


class WebsiteSettingsView(TenantScopedViewSetMixin, APIView):
    """Singleton site settings. `GET` never writes; the first `PATCH` creates the site."""

    authentication_classes = [JWTAuthentication]
    permission_classes = STAFF_PERMISSIONS
    required_feature = FEATURE
    required_permission = READ_KEY
    required_permission_map = {"patch": "website.settings.update"}
    scope_campus_field = None
    serializer_class = WebsiteSettingsSerializer

    @extend_schema(responses={200: WebsiteSettingsSerializer})
    def get(self, request) -> Response:
        row = WebsiteSettings.objects.alive().select_related(
            "theme"
        ).first() or services.unsaved_default(request.tenant)
        return ActionResponse.ok(WebsiteSettingsSerializer(row).data)

    @extend_schema(request=WebsiteSettingsSerializer, responses={200: WebsiteSettingsSerializer})
    def patch(self, request) -> Response:
        serializer = WebsiteSettingsSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        row = services.ensure_default_site(request.tenant, request.user.pk)
        before = WebsiteSettingsSerializer(row).data
        row, changed = services.update_settings(
            row, _model_fields(serializer.validated_data), request.user.pk
        )
        after = WebsiteSettingsSerializer(row).data
        if changed:
            record_audit(request, "update", row, before=before, after=after)
            extra = [host_tag(request.tenant)] if changed & services.HOST_TAG_FIELDS else []
            queue_revalidation(request.tenant.pk, extra)
        return ActionResponse.ok(after, message="Website settings updated.")


def _model_fields(validated: dict) -> dict:
    """`validated_data` with `social_links` as plain dicts, ready to compare and store."""
    return {
        name: [dict(link) for link in value] if name == "social_links" else value
        for name, value in validated.items()
    }


class ThemeViewSet(TenantScopedViewSetMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    """`GET /themes`: the platform theme catalogue (no tenant data, active themes only)."""

    authentication_classes = [JWTAuthentication]
    permission_classes = STAFF_PERMISSIONS
    queryset = Theme.objects
    serializer_class = ThemeSerializer
    pagination_class = PageNumberPagination
    required_feature = FEATURE
    required_permission = READ_KEY
    scope_campus_field = None
    ordering_fields = ["code", "name"]
    ordering = ["code", "id"]
    http_method_names = ["get", "head", "options"]

    def get_queryset(self):
        # Platform scope: no tenant column or soft delete, so the mixin's narrowing is skipped.
        return Theme.objects.filter(is_active=True)
