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

from core.api.permissions import RequiresModuleFeature
from core.audit.services import record_audit
from core.rbac.permissions import HasPermissionKey, scope_queryset
from core.tenancy.context import bind_tenant, unbind_tenant
from core.tenancy.models import Tenant


class TenantScopedViewSetMixin:
    """Applies tenant + record-scope narrowing and writes audit entries.

    Subclasses declare::

        required_feature = "module.students"   # optional; None means "core, ungated"
        required_permission = "students.student.view"
        required_permission_map = {"create": "students.student.create", ...}
        scope_own_field = "user_id"      # optional, the simple `own` record scope
        scope_campus_field = "student__campus_id"  # override on a table with no own campus_id

    ``RequiresModuleFeature`` runs before ``HasPermissionKey`` deliberately —
    docs/02-architecture/auth-and-rbac.md §2.3 orders the module-level check
    ahead of the feature-level (permission-key) check, and DRF evaluates
    ``permission_classes`` in list order.

    ``scope_own_field`` is only the *fallback* for ``RecordScope.OWN``. When "own"
    means more than one column — a guardian's own children, say — the model
    declares a ``filter_owned_by_user`` classmethod and ``scope_queryset`` prefers
    it, the same way ``filter_assigned_to_user`` already works for
    ``RecordScope.ASSIGNED``. See ``apps.student_management.models.Student``.

    ``scope_campus_field`` defaults to ``"campus_id"``, which only the parent
    resource in a module tends to have — a child table (a student's guardians,
    documents, …) has no such column of its own. Getting this wrong is not a
    narrow leak: ``scope_queryset``'s ``RecordScope.CAMPUS`` branch filters on
    whatever this names, so a table without that column raises ``FieldError``
    for every campus-scoped user the moment they hit the endpoint — override it
    per child viewset rather than leaving the default.
    """

    permission_classes = [IsAuthenticated, RequiresModuleFeature, HasPermissionKey]
    required_feature: str | None = None
    scope_own_field: str | None = None
    # `None` = this table has no campus dimension (classes, subjects, houses are
    # defined once per school). See `scope_queryset` for why that passes through
    # rather than narrowing to nothing.
    scope_campus_field: str | None = "campus_id"
    audit_resource: str | None = None

    def initial(self, request, *args, **kwargs):
        """Bind the tenant here rather than relying on middleware alone.

        Two reasons this cannot live only in middleware:

        1. Authentication is DRF's, not Django's. With JWT there is no session, so
           Django's ``request.user`` is still anonymous while middleware runs and the
           tenant would never be resolved in production — a gap the tests hide by
           also calling ``force_login``.
        2. ``SET LOCAL`` only has effect inside a transaction. ``ATOMIC_REQUESTS``
           opens that transaction around the *view*, not around middleware, so a
           binding made earlier would silently do nothing.

        Accessing ``request.user`` forces DRF authentication, so the tenant is bound
        before permission and throttle checks run.
        """
        user = request.user
        tenant = getattr(request, "tenant", None)

        if tenant is None and getattr(user, "is_authenticated", False):
            tenant = self._resolve_tenant(user)
            request.tenant = tenant
            # DRF wraps the Django request; module code and audit reach for either.
            request._request.tenant = tenant

        if tenant is not None:
            self._tenant_token = bind_tenant(tenant.pk)

        super().initial(request, *args, **kwargs)

    def finalize_response(self, request, response, *args, **kwargs):
        token = getattr(self, "_tenant_token", None)
        if token is not None:
            unbind_tenant(token)
            self._tenant_token = None
        return super().finalize_response(request, response, *args, **kwargs)

    @staticmethod
    def _resolve_tenant(user):
        tenant_id = getattr(user, "tenant_id", None)
        if tenant_id is None:
            return None
        return (
            Tenant.objects.filter(pk=tenant_id, deleted_at__isnull=True)
            .only("id", "name", "slug", "status", "timezone", "locale", "currency")
            .first()
        )

    def get_queryset(self):
        # The model's default manager is already tenant-scoped, and RLS enforces it
        # in the database; this narrows further by the user's record scope.
        queryset = super().get_queryset().alive()
        return scope_queryset(
            queryset,
            self.request.user,
            own_field=self.scope_own_field,
            campus_field=self.scope_campus_field,
        )

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
