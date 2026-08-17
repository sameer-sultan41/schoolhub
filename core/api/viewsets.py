"""Base viewsets every module app builds on.

Centralizing tenancy, permission enforcement, soft delete, and audit here means a
module author cannot forget them — the safe behavior is the default, and opting out
is explicit and reviewable.
"""

from __future__ import annotations

from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.audit.services import record_audit
from core.rbac.permissions import HasPermissionKey, scope_queryset


class TenantScopedViewSetMixin:
    """Applies tenant + record-scope narrowing and writes audit entries.

    Subclasses declare::

        required_permission = "students.student.view"
        required_permission_map = {"create": "students.student.create", ...}
        scope_own_field = "user_id"      # optional, enables the `own` record scope
    """

    permission_classes = [IsAuthenticated, HasPermissionKey]
    scope_own_field: str | None = None
    audit_resource: str | None = None

    def get_queryset(self):
        # The model's default manager is already tenant-scoped, and RLS enforces it
        # in the database; this narrows further by the user's record scope.
        queryset = super().get_queryset().alive()
        return scope_queryset(queryset, self.request.user, own_field=self.scope_own_field)

    def perform_create(self, serializer):
        instance = serializer.save(
            tenant=self.request.tenant,
            created_by=self.request.user.pk,
            updated_by=self.request.user.pk,
        )
        record_audit(self.request, "create", instance, after=serializer.data)

    def perform_update(self, serializer):
        before = self.get_serializer(serializer.instance).data
        instance = serializer.save(updated_by=self.request.user.pk)
        record_audit(self.request, "update", instance, before=before, after=serializer.data)

    def perform_destroy(self, instance):
        """Soft delete. Hard deletes are a data-retention operation, not an API action."""
        before = self.get_serializer(instance).data
        instance.deleted_at = timezone.now()
        instance.updated_by = self.request.user.pk
        instance.save(update_fields=["deleted_at", "updated_by", "updated_at"])
        record_audit(self.request, "delete", instance, before=before)


class TenantModelViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """Full CRUD for a tenant-owned resource."""


class TenantReadOnlyViewSet(TenantScopedViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """Read-only view of a tenant-owned resource."""


class TenantListCreateViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """For append-mostly resources where update/delete are not meaningful."""


class ActionResponse:
    """Helper for colon-action endpoints (`POST /students/{id}:promote`).

    Domain actions return the affected resource plus a short outcome so clients do
    not have to re-fetch to learn what happened.
    """

    @staticmethod
    def ok(data=None, message: str | None = None, status: int = 200) -> Response:
        payload: dict = {"data": data}
        if message:
            payload["meta"] = {"message": message}
        return Response(payload, status=status)

    @staticmethod
    def accepted(job_id: str, message: str = "Queued.") -> Response:
        """202 for long-running work; clients poll GET /api/v1/jobs/{id}."""
        return Response(
            {"data": {"job_id": job_id, "status": "queued"}, "meta": {"message": message}},
            status=202,
        )
