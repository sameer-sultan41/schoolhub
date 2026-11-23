"""`/platform/tenants`: the console's tenant list, create, detail and lifecycle actions (§16).

Two viewsets, because the routes bind differently:
- `TenantViewSet` (list, create) reads and writes the platform-scope ``tenants`` table only,
  with no tenant bound;
- `TenantDetailViewSet` serves ``tenants/{tenant_pk}`` and its colon-actions, and binds that
  one school for the whole request (`PlatformTenantNestedMixin`), so `:provision` seeds its
  rows under its own RLS boundary and each action's replay record and audit row belong to it.

Every colon-action runs under ``Idempotency-Key`` (`run_idempotent`). Each one is also safe
without a key: the lifecycle refuses a repeated move with a 409, under the row lock.
"""

from __future__ import annotations

from collections.abc import Callable

from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import mixins
from rest_framework.request import Request
from rest_framework.response import Response

from apps.platform_admin.tenants import services
from apps.platform_admin.tenants.filters import TenantFilterSet
from apps.platform_admin.tenants.serializers import (
    DeleteSerializer,
    ProvisionSerializer,
    ReasonSerializer,
    ReinstateSerializer,
    TenantCreateSerializer,
    TenantSerializer,
    TenantUpdateSerializer,
)
from core.api.pagination import PageNumberPagination
from core.api.platform import PlatformTenantNestedMixin, PlatformViewSet
from core.api.viewsets import ActionResponse
from core.audit.services import record_audit
from core.tenancy.models import Tenant

_CONFLICT = OpenApiResponse(
    description="invalid_transition: the tenant's status does not allow this action."
)


class TenantViewSet(mixins.ListModelMixin, PlatformViewSet):
    """`GET/POST /platform/tenants`."""

    queryset = Tenant.objects.filter(deleted_at__isnull=True)
    serializer_class = TenantSerializer
    filterset_class = TenantFilterSet
    search_fields = ["name", "slug", "contact_email"]
    # Bounded by the number of schools on the platform, and read by position.
    pagination_class = PageNumberPagination
    # `id` breaks ties between schools of one name, so page boundaries are stable.
    ordering = ["name", "id"]
    # `slug` is unique-indexed and `status` indexed; the rest scan a table of schools.
    ordering_fields = ["name", "slug", "status", "trial_ends_at", "created_at"]
    required_permission = "platform.tenant.view"
    required_permission_map = {"create": "platform.tenant.provision"}
    http_method_names = ["get", "post", "head", "options"]

    @extend_schema(
        summary="Create a school, in provisioning",
        request=TenantCreateSerializer,
        responses={201: TenantSerializer},
    )
    def create(self, request: Request) -> Response:
        payload = TenantCreateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        tenant = services.create_tenant(**payload.validated_data, actor_id=request.user.pk)
        data = TenantSerializer(tenant).data
        record_audit(request, "create", tenant, after=data)
        return ActionResponse.ok(data, message="School created.", status=201)


class TenantDetailViewSet(PlatformTenantNestedMixin, PlatformViewSet):
    """`GET/PATCH /platform/tenants/{tenant_pk}` and its lifecycle colon-actions."""

    queryset = Tenant.objects.filter(deleted_at__isnull=True)
    serializer_class = TenantSerializer
    required_permission = "platform.tenant.view"
    required_permission_map = {
        "partial_update": "platform.tenant.update",
        "provision": "platform.tenant.provision",
        "suspend": "platform.tenant.suspend",
        "reinstate": "platform.tenant.reinstate",
        "deprovision": "platform.tenant.delete",
        # Undoing a deprovision is the deleting authority's call; §4 has no restore key.
        "restore": "platform.tenant.delete",
    }
    http_method_names = ["get", "post", "patch", "head", "options"]

    def retrieve(self, request: Request, tenant_pk=None) -> Response:
        return Response(TenantSerializer(request.tenant).data)

    @extend_schema(
        summary="Edit a school's name and contact; its slug only while provisioning",
        request=TenantUpdateSerializer,
        responses={200: TenantSerializer},
    )
    def partial_update(self, request: Request, tenant_pk=None) -> Response:
        payload = TenantUpdateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        before = TenantSerializer(request.tenant).data
        tenant = services.update_tenant(
            request.tenant, data=payload.validated_data, actor_id=request.user.pk
        )
        after = TenantSerializer(tenant).data
        record_audit(request, "update", tenant, before=before, after=after)
        return ActionResponse.ok(after, message="School updated.")

    @extend_schema(
        summary="Provision: seed settings, invite the owner and start the trial",
        request=ProvisionSerializer,
        responses={
            200: TenantSerializer,
            409: _CONFLICT,
            422: OpenApiResponse(description="A plan_code before plans exist, or no contact"),
        },
    )
    def provision(self, request: Request, tenant_pk=None) -> Response:
        payload = ProvisionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        def execute() -> Response:
            return self._lifecycle_action(
                request,
                "provision",
                lambda tenant: services.provision_tenant(
                    tenant,
                    plan_code=payload.validated_data["plan_code"],
                    actor_id=request.user.pk,
                ),
                message="School provisioned; the owner has been invited.",
            )

        return self.run_idempotent("platform-tenants:provision", execute)

    @extend_schema(
        summary="Suspend a school (reason required)",
        request=ReasonSerializer,
        responses={200: TenantSerializer, 409: _CONFLICT},
    )
    def suspend(self, request: Request, tenant_pk=None) -> Response:
        payload = ReasonSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        reason = payload.validated_data["reason"]

        def execute() -> Response:
            return self._lifecycle_action(
                request,
                "suspend",
                lambda tenant: services.suspend_tenant(
                    tenant, reason=reason, actor_id=request.user.pk
                ),
                message="School suspended.",
                reason=reason,
            )

        return self.run_idempotent("platform-tenants:suspend", execute)

    @extend_schema(
        summary="Reinstate a suspended school to the status its subscription implies",
        request=ReinstateSerializer,
        responses={
            200: TenantSerializer,
            409: OpenApiResponse(description="invalid_transition, or no_live_subscription"),
        },
    )
    def reinstate(self, request: Request, tenant_pk=None) -> Response:
        payload = ReinstateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        def execute() -> Response:
            return self._lifecycle_action(
                request,
                "reinstate",
                lambda tenant: services.reinstate_tenant(
                    tenant,
                    trial_ends_at=data["trial_ends_at"],
                    actor_id=request.user.pk,
                    reason=data["reason"],
                ),
                message="School reinstated.",
                reason=data["reason"],
            )

        return self.run_idempotent("platform-tenants:reinstate", execute)

    @extend_schema(
        summary="Start deprovisioning (reason, and an export or a waiver, required)",
        request=DeleteSerializer,
        responses={
            200: TenantSerializer,
            409: OpenApiResponse(description="invalid_transition, or export_required"),
        },
    )
    def deprovision(self, request: Request, tenant_pk=None) -> Response:
        payload = DeleteSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        def execute() -> Response:
            return self._lifecycle_action(
                request,
                "delete",
                lambda tenant: services.delete_tenant(
                    tenant,
                    reason=data["reason"],
                    waive_export=data["waive_export"],
                    actor_id=request.user.pk,
                ),
                message="School deprovisioned; its retention window has started.",
                reason=data["reason"],
                waive_export=data["waive_export"],
            )

        return self.run_idempotent("platform-tenants:delete", execute)

    @extend_schema(
        summary="Restore a deprovisioned school inside its retention window (as suspended)",
        request=ReasonSerializer,
        responses={
            200: TenantSerializer,
            409: OpenApiResponse(description="invalid_transition, or retention_expired"),
        },
    )
    def restore(self, request: Request, tenant_pk=None) -> Response:
        payload = ReasonSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        reason = payload.validated_data["reason"]

        def execute() -> Response:
            return self._lifecycle_action(
                request,
                "restore",
                lambda tenant: services.restore_tenant(
                    tenant, reason=reason, actor_id=request.user.pk
                ),
                message="School restored; it stays suspended until reinstated.",
                reason=reason,
            )

        return self.run_idempotent("platform-tenants:restore", execute)

    @staticmethod
    def _lifecycle_action(
        request: Request,
        action: str,
        run: Callable[[Tenant], Tenant],
        *,
        message: str,
        **context: object,
    ) -> Response:
        """Run one action on the bound school and audit it with its before and after."""
        before = TenantSerializer(request.tenant).data
        tenant = run(request.tenant)
        after = TenantSerializer(tenant).data
        record_audit(request, action, tenant, before=before, after={**after, **context})
        return ActionResponse.ok(after, message=message)
