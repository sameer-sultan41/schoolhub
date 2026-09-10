"""`AcademicSessionViewSet` — request handling for `/academic-sessions`
(module doc §5.4, §7).
"""

from __future__ import annotations

from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.response import Response

from apps.school_organization.academic_sessions.filters import AcademicSessionFilterSet
from apps.school_organization.academic_sessions.serializers import (
    AcademicSessionSerializer,
    SessionCloneSerializer,
)
from apps.school_organization.academic_sessions.services.activate import activate_session
from apps.school_organization.academic_sessions.services.clone import clone_session
from apps.school_organization.academic_sessions.services.close import close_session
from apps.school_organization.models import AcademicSession
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit


class AcademicSessionViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Academic sessions and their lifecycle (module doc §5.4, §7).

    No destroy: §16 exposes no DELETE and §4 grants no delete key. A session that
    should no longer be used is closed, which keeps its history addressable.
    """

    # Tenant-wide: a school year is not per-campus. See `scope_queryset`.
    scope_campus_field = None
    queryset = AcademicSession.objects
    serializer_class = AcademicSessionSerializer
    filterset_class = AcademicSessionFilterSet
    search_fields = ["name"]
    ordering_fields = ["start_date", "name", "created_at"]
    required_feature = "module.school"
    required_permission = "school.academic-session.view"
    required_permission_map = {
        "create": "school.academic-session.create",
        "update": "school.academic-session.update",
        "partial_update": "school.academic-session.update",
        "activate": "school.academic-session.activate",
        "close": "school.academic-session.close",
        "clone": "school.academic-session.create",
    }

    @extend_schema(
        summary="Activate an academic session",
        request=None,
        responses={
            200: AcademicSessionSerializer,
            422: OpenApiResponse(description="Structure incomplete for activation"),
        },
    )
    def activate(self, request, pk=None) -> Response:
        session = self.get_object()
        before = self.get_serializer(session).data
        session = activate_session(session, actor_id=request.user.pk)
        after = self.get_serializer(session).data
        record_audit(request, "activate", session, before=before, after=after)
        return ActionResponse.ok(after, message="Session activated.")

    @extend_schema(
        summary="Close an academic session",
        request=None,
        responses={200: AcademicSessionSerializer, 409: OpenApiResponse(description="Not active")},
    )
    def close(self, request, pk=None) -> Response:
        session = self.get_object()
        before = self.get_serializer(session).data
        session = close_session(session, actor_id=request.user.pk)
        after = self.get_serializer(session).data
        record_audit(request, "close", session, before=before, after=after)
        return ActionResponse.ok(after, message="Session closed.")

    @extend_schema(
        summary="Clone a session's curriculum into a new session",
        request=SessionCloneSerializer,
        responses={201: AcademicSessionSerializer},
    )
    def clone(self, request, pk=None) -> Response:
        source = self.get_object()
        payload = SessionCloneSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        target = clone_session(
            source,
            actor_id=request.user.pk,
            tenant_id=request.tenant.pk,
            **payload.validated_data,
        )
        data = self.get_serializer(target).data
        record_audit(request, "create", target, after=data)
        return ActionResponse.ok(
            data, message=f"Cloned from '{source.name}'.", status=status.HTTP_201_CREATED
        )
