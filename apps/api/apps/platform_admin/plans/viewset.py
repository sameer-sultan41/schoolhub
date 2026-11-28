"""`/platform/plans`: the plan catalog (platform-admin.md §16).

Platform scope throughout: no tenant is bound, and the audit rows carry none. A plan edit
reaches every school on it at once (`services.update_plan` invalidates the feature cache).
"""

from __future__ import annotations

from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import mixins
from rest_framework.request import Request
from rest_framework.response import Response

from apps.platform_admin.models import Plan
from apps.platform_admin.plans import services
from apps.platform_admin.plans.filters import PlanFilterSet
from apps.platform_admin.plans.serializers import PlanSerializer, PlanWriteSerializer
from core.api.pagination import PageNumberPagination
from core.api.platform import PlatformViewSet
from core.api.viewsets import ActionResponse
from core.audit.services import record_audit


class PlanViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, PlatformViewSet):
    """`GET/POST /platform/plans` and `GET/PATCH/DELETE /platform/plans/{id}`."""

    queryset = Plan.objects.filter(deleted_at__isnull=True)
    serializer_class = PlanSerializer
    filterset_class = PlanFilterSet
    search_fields = ["name", "code"]
    # A catalog of a handful of tiers, read by position.
    pagination_class = PageNumberPagination
    ordering = ["name"]
    ordering_fields = ["name", "code", "price_amount", "created_at"]
    required_permission = "platform.plan.view"
    required_permission_map = {
        "create": "platform.plan.create",
        "partial_update": "platform.plan.update",
        "destroy": "platform.plan.delete",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    @extend_schema(
        summary="Add a plan to the catalog",
        request=PlanWriteSerializer,
        responses={201: PlanSerializer},
    )
    def create(self, request: Request) -> Response:
        payload = PlanWriteSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        fields = dict(payload.validated_data)
        # Nothing to be below on a new plan: no school is on it yet.
        fields.pop("acknowledge_over_usage", None)
        plan = services.create_plan(data=fields, actor_id=request.user.pk)
        data = PlanSerializer(plan).data
        record_audit(request, "create", plan, after=data)
        return ActionResponse.ok(data, message="Plan created.", status=201)

    @extend_schema(
        summary="Edit a plan (its code is fixed); module access follows at once",
        request=PlanWriteSerializer,
        responses={
            200: PlanSerializer,
            409: OpenApiResponse(
                description="limit_below_usage: a limit would drop below a school's latest "
                "usage; `meta.over_usage` lists each school and metric."
            ),
        },
    )
    def partial_update(self, request: Request, pk=None) -> Response:
        plan = self.get_object()
        payload = PlanWriteSerializer(plan, data=request.data, partial=True)
        payload.is_valid(raise_exception=True)
        before = PlanSerializer(plan).data
        fields = dict(payload.validated_data)
        acknowledged = fields.pop("acknowledge_over_usage", False)
        plan = services.update_plan(
            plan, data=fields, actor_id=request.user.pk, acknowledge_over_usage=acknowledged
        )
        after = PlanSerializer(plan).data
        record_audit(request, "update", plan, before=before, after=after)
        return ActionResponse.ok(after, message="Plan updated.")

    @extend_schema(
        summary="Retire a plan (soft delete)",
        responses={
            204: None,
            409: OpenApiResponse(description="plan_in_use: a school is on this plan."),
        },
    )
    def destroy(self, request: Request, pk=None) -> Response:
        plan = self.get_object()
        before = PlanSerializer(plan).data
        plan = services.delete_plan(plan, actor_id=request.user.pk)
        record_audit(request, "delete", plan, before=before)
        return Response(status=204)
