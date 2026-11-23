"""`/platform/tenants/{tenant_pk}/subscription`: a school's subscription, from the console.

Nested under the school and bound to it for the whole request (`PlatformTenantNestedMixin`),
since `subscriptions` is under RLS: the console reads and writes one school's row and no
other's. A school has at most one live subscription, so the route names no subscription id.

Every colon-action runs under ``Idempotency-Key``. Each is also safe without one: a repeated
move is a 409 ``invalid_transition`` under the row lock.
"""

from __future__ import annotations

from collections.abc import Callable

from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response

from apps.platform_admin.models import Subscription
from apps.platform_admin.subscriptions import services
from apps.platform_admin.subscriptions.serializers import (
    SubscriptionActivateSerializer,
    SubscriptionChangePlanSerializer,
    SubscriptionPaymentSerializer,
    SubscriptionStateSerializer,
    SubscriptionUpdateSerializer,
)
from apps.platform_admin.tenants.services import NoLiveSubscription
from core.api.platform import PlatformTenantNestedMixin, PlatformViewSet
from core.api.viewsets import ActionResponse
from core.audit.services import record_audit

NO_SUBSCRIPTION = "This school has no live subscription."
PLAN_REQUIRED = "Name the plan the school is paying for."
USE_CHANGE_PLAN = "The school already has a subscription; change its plan with :change-plan."

_CONFLICT = OpenApiResponse(
    description="invalid_transition: the subscription's status does not allow this move; "
    "no_live_subscription: the school has none."
)
_PLAN_CONFLICT = OpenApiResponse(
    description="invalid_transition: the subscription's status does not allow this move; "
    "no_live_subscription: the school has none; toggle_refused: the plan would switch off a "
    "module the school still needs."
)
_ACTIVATE_CONFLICT = OpenApiResponse(
    description="invalid_transition: the subscription's status does not allow this move; "
    "subscription_exists: the school already has a live subscription; toggle_refused: the "
    "plan would switch off a module the school still needs."
)
_UPDATE = "platform.subscription.update"


class TenantSubscriptionViewSet(PlatformTenantNestedMixin, PlatformViewSet):
    """`GET/PATCH .../subscription` and `:activate`, `:record-payment`,
    `:mark-payment-failed`, `:change-plan`."""

    serializer_class = SubscriptionStateSerializer
    required_permission = "platform.subscription.view"
    required_permission_map = {
        "partial_update": _UPDATE,
        "activate": _UPDATE,
        "record_payment": _UPDATE,
        "mark_payment_failed": _UPDATE,
        "change_plan": _UPDATE,
    }
    http_method_names = ["get", "post", "patch", "head", "options"]

    @extend_schema(summary="A school's billing state: its live subscription and its limits")
    def retrieve(self, request: Request, tenant_pk=None) -> Response:
        return Response(self._state(request))

    @extend_schema(
        summary="Set the billing provider, its reference or negotiated limits",
        request=SubscriptionUpdateSerializer,
        responses={200: SubscriptionStateSerializer, 409: _CONFLICT},
    )
    def partial_update(self, request: Request, tenant_pk=None) -> Response:
        payload = SubscriptionUpdateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return self._act(
            request,
            "update",
            lambda sub: services.update_subscription(
                self._live(sub), data=payload.validated_data, actor_id=request.user.pk
            ),
            message="Subscription updated.",
        )

    @extend_schema(
        summary="Activate: a trial converts, or a school with none starts paying for a plan",
        request=SubscriptionActivateSerializer,
        responses={
            200: SubscriptionStateSerializer,
            409: _ACTIVATE_CONFLICT,
            422: OpenApiResponse(description="No active plan has this code."),
        },
    )
    def activate(self, request: Request, tenant_pk=None) -> Response:
        payload = SubscriptionActivateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        period = {
            "period_start": data["current_period_start"],
            "period_end": data["current_period_end"],
        }

        def run(sub: Subscription | None) -> Subscription:
            code = data["plan_code"]
            if sub is None:
                if not code:
                    raise serializers.ValidationError({"plan_code": [PLAN_REQUIRED]})
                return services.subscribe(request.tenant, code, **period, actor_id=request.user.pk)
            if code and code != sub.plan.code:
                raise serializers.ValidationError({"plan_code": [USE_CHANGE_PLAN]})
            return services.activate(sub, **period, actor_id=request.user.pk)

        return self._idempotent(request, "activate", run, message="Subscription activated.")

    @extend_schema(
        summary="Record a payment: the paid period runs on, and a past-due school recovers",
        request=SubscriptionPaymentSerializer,
        responses={200: SubscriptionStateSerializer, 409: _CONFLICT},
    )
    def record_payment(self, request: Request, tenant_pk=None) -> Response:
        payload = SubscriptionPaymentSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        paid_through = payload.validated_data["paid_through"]
        return self._idempotent(
            request,
            "record_payment",
            lambda sub: services.record_payment(
                self._live(sub), paid_through=paid_through, actor_id=request.user.pk
            ),
            message="Payment recorded.",
        )

    @extend_schema(
        summary="Mark a payment failed: the subscription and the school become past due",
        request=None,
        responses={200: SubscriptionStateSerializer, 409: _CONFLICT},
    )
    def mark_payment_failed(self, request: Request, tenant_pk=None) -> Response:
        return self._idempotent(
            request,
            "mark_payment_failed",
            lambda sub: services.mark_payment_failed(self._live(sub), actor_id=request.user.pk),
            message="Payment marked failed; the school is past due.",
        )

    @extend_schema(
        summary="Move the live subscription to another plan; module access follows at once",
        request=SubscriptionChangePlanSerializer,
        responses={
            200: SubscriptionStateSerializer,
            409: _PLAN_CONFLICT,
            422: OpenApiResponse(description="No active plan has this code, or it is the same."),
        },
    )
    def change_plan(self, request: Request, tenant_pk=None) -> Response:
        payload = SubscriptionChangePlanSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        code = payload.validated_data["plan_code"]
        return self._idempotent(
            request,
            "change_plan",
            lambda sub: services.change_plan(self._live(sub), code, actor_id=request.user.pk),
            message="Plan changed.",
        )

    # ------------------------------------------------------------------------- helpers

    @staticmethod
    def _state(request: Request) -> dict:
        return SubscriptionStateSerializer(services.describe(request.tenant)).data

    @staticmethod
    def _live(sub: Subscription | None) -> Subscription:
        if sub is None:
            raise NoLiveSubscription(NO_SUBSCRIPTION)
        return sub

    def _idempotent(
        self,
        request: Request,
        action: str,
        run: Callable[[Subscription | None], Subscription],
        *,
        message: str,
    ) -> Response:
        endpoint = f"platform-subscription:{action}"
        return self.run_idempotent(
            endpoint, lambda: self._act(request, action, run, message=message)
        )

    def _act(
        self,
        request: Request,
        action: str,
        run: Callable[[Subscription | None], Subscription],
        *,
        message: str,
    ) -> Response:
        """Run one write on the bound school's live subscription and audit it."""
        before = self._state(request)
        sub = run(services.live_subscription(request.tenant.pk))
        after = self._state(request)
        record_audit(request, action, sub, before=before, after=after)
        return ActionResponse.ok(after, message=message)
