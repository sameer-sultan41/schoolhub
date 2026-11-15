"""`/navigation-menus`: singleton-per-location menus. `GET` never writes."""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from apps.website_cms.models import MenuLocation
from apps.website_cms.navigation import services
from apps.website_cms.navigation.serializers import (
    NavigationMenuSerializer,
    NavigationMenuUpdateSerializer,
)
from apps.website_cms.views import FEATURE, STAFF_PERMISSIONS
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit

READ_KEY = "website.page.view"


class _MenuView(TenantScopedViewSetMixin, APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = STAFF_PERMISSIONS
    required_feature = FEATURE
    required_permission = READ_KEY
    required_permission_map = {"patch": "website.navigation.update"}
    scope_campus_field = None
    serializer_class = NavigationMenuSerializer


class NavigationMenuListView(_MenuView):
    @extend_schema(responses={200: NavigationMenuSerializer(many=True)})
    def get(self, request) -> Response:
        return ActionResponse.ok(NavigationMenuSerializer(services.list_menus(), many=True).data)


class NavigationMenuDetailView(_MenuView):
    @extend_schema(
        request=NavigationMenuUpdateSerializer, responses={200: NavigationMenuSerializer}
    )
    def patch(self, request, location: str) -> Response:
        if location not in MenuLocation.values:
            raise NotFound
        serializer = NavigationMenuUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        menu, before, changed = services.update_menu(
            request.tenant, location, serializer.validated_data["items"], request.user.pk
        )
        after = NavigationMenuSerializer(menu).data
        if changed:
            record_audit(
                request, "update", menu, before={"items": before}, after={"items": menu.items}
            )
        return ActionResponse.ok(after, message="Menu updated.")
