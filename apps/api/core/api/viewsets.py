"""Base viewsets every module app builds on.

Centralizing tenancy, permission enforcement, soft delete, and audit here means a
module author cannot forget them — the safe behavior is the default, and opting out
is explicit and reviewable.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.api.exceptions import TenantNotFound, TenantSuspended
from core.api.permissions import RequiresModuleFeature
from core.audit.services import record_audit
from core.rbac.permissions import (
    AnyOf,
    HasPermissionKey,
    RbacUser,
    ScopeKwargs,
    declared_keys,
    holds_key_for,
    required_declaration,
    scope_queryset,
)
from core.tenancy.access import log_refusal, operational_tenant
from core.tenancy.context import bind_tenant, unbind_tenant


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

    A route whose declaration is not the read key (an update, a delete, a colon
    action) is scoped by the read key and then by its own, so its target must be
    one the caller may read as well as act on. The read key is
    ``required_permission`` unless ``scope_read_permission`` names another, and
    ``scope_read_exempt_actions`` lists any action with no read requirement.
    """

    permission_classes = [IsAuthenticated, RequiresModuleFeature, HasPermissionKey]
    required_feature: str | None = None
    scope_own_field: str | None = None
    # `None` = this table has no campus dimension (classes, subjects, houses are
    # defined once per school). See `scope_queryset` for why that passes through
    # rather than narrowing to nothing.
    scope_campus_field: str | None = "campus_id"
    # True where the campus column is nullable and NULL means "every campus".
    # `IN (...)` drops NULL, so without this a campus-scoped principal silently
    # loses the tenant-wide rows — no error, just a shorter list.
    scope_campus_allows_null: bool = False
    # The key a row must be readable under before any other route acts on it (ADR-0031
    # decision 3). None means `required_permission`; set it where that is not the read key.
    scope_read_permission: str | AnyOf | None = None
    # Actions whose target need not be readable. Each use says why.
    scope_read_exempt_actions: frozenset[str] = frozenset()
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

    def _resolve_tenant(self, user):
        """The caller's tenant, refused exactly as `TenantMiddleware` refuses it.

        Under a bearer token the middleware never sees the user, so for a mixin view
        this is where a deleted or suspended tenant is turned away; sign-in and refresh
        apply the same rule (`core.tenancy.access`).
        """
        tenant_id = getattr(user, "tenant_id", None)
        if tenant_id is None:
            return None
        tenant, refusal = operational_tenant(tenant_id)
        if refusal is not None:
            log_refusal(refusal, path=getattr(self.request, "path", None))
            raise TenantSuspended() if refusal == "tenant_suspended" else TenantNotFound()
        return tenant

    def get_queryset(self):
        # The model's default manager is already tenant-scoped, and RLS enforces it
        # in the database; this narrows further by the user's record scope for this
        # route's own key, so only the roles granting that key count.
        queryset = super().get_queryset().alive()
        declared = required_declaration(self.request, self)
        if declared is None:
            # `HasPermissionKey` refuses such a route; never read one under no key.
            return queryset.none()
        scope = self.scope_kwargs()
        read = self.scope_read_declaration()
        if read is not None and set(declared_keys(read)) != set(declared_keys(declared)):
            # A route acting on a row (PATCH, DELETE, a colon action) finds it only if
            # the caller may read it too, so a wide action role cannot reach, or echo
            # back, a row their view role hides. ADR-0031 decision 3.
            queryset = scope_queryset(queryset, self.request.user, permission=read, **scope)
        return scope_queryset(queryset, self.request.user, permission=declared, **scope)

    def scope_read_declaration(self) -> str | AnyOf | None:
        """The read key a row this route acts on must also be reachable under.

        `scope_read_permission`, else `required_permission`; None for an action in
        `scope_read_exempt_actions`, which is then scoped by its own key alone.
        """
        if getattr(self, "action", None) in self.scope_read_exempt_actions:
            return None
        if self.scope_read_permission is not None:
            return self.scope_read_permission
        fallback: str | AnyOf | None = getattr(self, "required_permission", None)
        return fallback

    @classmethod
    def scope_kwargs(cls) -> ScopeKwargs:
        """This viewset's record-scope settings, the one source every scope check reads.

        `get_queryset`, `holds_key_for_row` and any check on a row this viewset
        serves (``holds_key_for(..., **SomeViewSet.scope_kwargs())``) read the same
        settings, so a privilege check cannot drift from what reading the row means.
        """
        return {
            "own_field": cls.scope_own_field,
            "campus_field": cls.scope_campus_field,
            "campus_allows_null": cls.scope_campus_allows_null,
        }

    def holds_key_for_row(
        self, user: RbacUser, permission: str | AnyOf, instance: models.Model
    ) -> bool:
        """`holds_key_for` under this viewset's own scope settings, for a row it serves."""
        return holds_key_for(user, permission, instance, **self.scope_kwargs())

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
    def accepted(job_id: str, message: str = "Queued.", data: dict | None = None) -> Response:
        """202 for long-running work; clients poll GET /api/v1/jobs/{id}.

        `data` adds typed fields beside `job_id` and `status`, for an action
        whose synchronous half has numbers a client renders itself.
        """
        return Response(
            {
                "data": {"job_id": job_id, "status": "queued", **(data or {})},
                "meta": {"message": message},
            },
            status=202,
        )
