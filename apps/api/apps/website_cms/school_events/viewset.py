"""`SchoolEventViewSet` — `/school-events` (module doc §16). No DELETE: §4 has no key for it."""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework_simplejwt.authentication import JWTAuthentication

from apps.website_cms.models import SchoolEvent
from apps.website_cms.permissions import PAGE_VIEW_KEY
from apps.website_cms.school_events import services
from apps.website_cms.school_events.filters import SchoolEventFilterSet
from apps.website_cms.school_events.serializers import (
    SchoolEventDetailSerializer,
    SchoolEventListSerializer,
    SchoolEventWriteSerializer,
)
from apps.website_cms.views import FEATURE, STAFF_PERMISSIONS
from core.api.pagination import PageNumberPagination
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit


class SchoolEventViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`school-events`: public website events with a publish workflow."""

    authentication_classes = [JWTAuthentication]
    permission_classes = STAFF_PERMISSIONS
    queryset = SchoolEvent.objects
    filterset_class = SchoolEventFilterSet
    search_fields = ["title", "slug", "location"]
    pagination_class = PageNumberPagination
    ordering_fields = ["title", "slug", "status", "starts_at", "created_at", "updated_at"]
    # SchoolEvent.Meta.ordering; the view repeats it because DRF reads the view's default.
    ordering = ["-starts_at", "id"]
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = PAGE_VIEW_KEY
    required_permission_map = {
        "create": "website.school-event.create",
        "update": "website.school-event.update",
        "partial_update": "website.school-event.update",
        "publish": "website.school-event.publish",
        "unpublish": "website.school-event.publish",
        "archive": "website.school-event.publish",
    }
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_serializer_class(self):
        if self.action == "list":
            return SchoolEventListSerializer
        if self.action in ("create", "partial_update"):
            return SchoolEventWriteSerializer
        return SchoolEventDetailSerializer

    @extend_schema(request=SchoolEventWriteSerializer, responses={201: SchoolEventDetailSerializer})
    def create(self, request: Request, *args, **kwargs) -> Response:
        serializer = SchoolEventWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        event = services.create_school_event(
            request.tenant, serializer.validated_data, request.user.pk
        )
        data = SchoolEventDetailSerializer(event).data
        record_audit(request, "create", event, after=data)
        return ActionResponse.ok(data, message="Event created.", status=201)

    @extend_schema(request=SchoolEventWriteSerializer, responses={200: SchoolEventDetailSerializer})
    def partial_update(self, request: Request, *args, **kwargs) -> Response:
        event = self.get_object()
        serializer = SchoolEventWriteSerializer(event, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        before = SchoolEventDetailSerializer(event).data
        event = services.update_school_event(event, serializer.validated_data, request.user.pk)
        data = SchoolEventDetailSerializer(event).data
        record_audit(request, "update", event, before=before, after=data)
        return ActionResponse.ok(data, message="Event updated.")

    def _transition(self, request: Request, action_name: str, message: str) -> Response:
        event = self.get_object()
        before = SchoolEventDetailSerializer(event).data
        event = getattr(services, f"{action_name}_school_event")(event, request.user)
        data = SchoolEventDetailSerializer(event).data
        record_audit(request, action_name, event, before=before, after=data)
        return ActionResponse.ok(data, message=message)

    @extend_schema(request=None, responses={200: SchoolEventDetailSerializer})
    def publish(self, request: Request, pk: str) -> Response:
        return self._transition(request, "publish", "Event published.")

    @extend_schema(request=None, responses={200: SchoolEventDetailSerializer})
    def unpublish(self, request: Request, pk: str) -> Response:
        return self._transition(request, "unpublish", "Event unpublished.")

    @extend_schema(request=None, responses={200: SchoolEventDetailSerializer})
    def archive(self, request: Request, pk: str) -> Response:
        return self._transition(request, "archive", "Event archived.")
