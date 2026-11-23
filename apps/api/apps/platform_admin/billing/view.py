"""`POST /api/v1/platform/billing-events/{provider}`: the billing provider's webhook (§16).

A plain `APIView` (ruling A6), not a `PlatformViewSet`: the provider has no platform login.
Trust comes from the signature over the raw body, and nothing in the URL names a school;
`services.handle_event` finds it from the event's provider reference.

Not wrapped in ``ATOMIC_REQUESTS`` (urls.py): a refused signature still records its security
event, and `handle_event` runs its own transaction.

| Case | Response |
| --- | --- |
| Unknown or disabled provider | 404 |
| No webhook secret configured | 503 `billing_unavailable` |
| Bad signature, stale timestamp or malformed body | 401 `invalid_signature`, and a security event |
| Verified, including replays and unknown references | 200 `{"received": true, "outcome": ...}` |

Failed signatures count against a per-IP budget, so guessing is slowed without slowing a
genuine provider. Only verified events count against the provider-wide budget, after the
signature check: unsigned posts, however many addresses send them, cannot use it up and
starve the provider's real deliveries.
"""

from __future__ import annotations

from django.conf import settings
from drf_spectacular.utils import OpenApiResponse, extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.exceptions import NotFound, Throttled
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.platform_admin.billing import services
from apps.platform_admin.billing.base import InvalidBillingSignature
from apps.platform_admin.billing.registry import webhook_adapter
from apps.platform_admin.models import BillingOutcome
from apps.platform_admin.tasks import send_payment_failed_notice
from core.api.exceptions import CodedAPIException
from core.api.throttling import BillingEventFailureThrottle, BillingEventThrottle
from core.api.viewsets import ActionResponse
from core.audit.services import record_security_event


class InvalidBillingEventSignature(CodedAPIException):
    status_code = status.HTTP_401_UNAUTHORIZED
    default_detail = "The event signature is invalid or stale."
    default_code = "invalid_signature"


class BillingUnavailable(CodedAPIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "Billing webhooks are not configured."
    default_code = "billing_unavailable"


class BillingEventView(APIView):
    authentication_classes: list = []
    permission_classes = [AllowAny]
    # Throttled by hand: failures per IP before verifying, verified events per provider after.
    throttle_classes: list = []

    @extend_schema(
        summary="A billing provider's event: a school's payment succeeded or failed",
        request=None,
        responses={
            200: inline_serializer(
                "BillingEventReceived",
                {
                    "received": serializers.BooleanField(),
                    "outcome": serializers.ChoiceField(choices=BillingOutcome.choices),
                },
            ),
            401: OpenApiResponse(description="invalid_signature"),
            404: OpenApiResponse(description="Unknown or disabled provider."),
            503: OpenApiResponse(description="billing_unavailable: no webhook secret."),
        },
        auth=[],
    )
    def post(self, request: Request, provider: str) -> Response:
        failures = BillingEventFailureThrottle()
        if failures.is_blocked(request):
            raise Throttled(wait=failures.retry_after(request))

        adapter = webhook_adapter(provider)
        if adapter is None:
            failures.record_failure(request)
            raise NotFound()
        if not settings.PLATFORM_BILLING_WEBHOOK_SECRET:
            raise BillingUnavailable()

        try:
            event = adapter.verify_event(request.headers, request.body)
        except InvalidBillingSignature as exc:
            failures.record_failure(request)
            record_security_event(request, "billing_event.invalid_signature", provider=provider)
            raise InvalidBillingEventSignature() from exc

        verified = BillingEventThrottle()
        if not verified.allow_request(request, self):
            raise Throttled(wait=verified.wait())

        handled = services.handle_event(provider, event)
        if (
            handled.is_new
            and handled.outcome == BillingOutcome.APPLIED
            and event.kind == "payment_failed"
            and handled.tenant is not None
        ):
            # After `handle_event`'s commit: the notice reads the school's new state. A replay
            # queues nothing: the first delivery already did.
            send_payment_failed_notice.delay(tenant_id=str(handled.tenant.pk))
        return ActionResponse.ok({"received": True, "outcome": handled.outcome})
