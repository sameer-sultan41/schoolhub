"""`POST /platform/billing-events/{provider}`: the billing provider's webhook (§6, §7.2).

Unauthenticated and HMAC-verified. The school is found through the platform-scope
`tenants.billing_provider_ref`, with nothing bound, and the view then binds it by hand.
"""

from __future__ import annotations

import json
import time
from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status

from apps.platform_admin.models import BillingEventReceipt, SubscriptionStatus
from apps.platform_admin.subscriptions import services
from apps.platform_admin.tests.base import make_plan, make_tenant
from apps.platform_admin.tests.test_subscriptions import live_on, reload
from core.audit.models import AuditLog
from core.integrations.payments.fake import sign
from core.tenancy.models import TenantStatus

SECRET = "billing-webhook-test-secret"
URL = "/api/v1/platform/billing-events/fake"
REF = "cus_school_1"
S = TenantStatus
SUB = SubscriptionStatus


def event(kind: str, *, event_id: str = "evt_1", ref: str = REF, paid_through=None) -> bytes:
    payload = {"id": event_id, "type": kind, "provider_ref": ref}
    if paid_through is not None:
        payload["paid_through"] = paid_through.isoformat()
    return json.dumps(payload).encode()


@override_settings(
    PLATFORM_BILLING_WEBHOOK_SECRET=SECRET, PLATFORM_BILLING_PROVIDERS_ENABLED=["fake"]
)
class BillingWebhookTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        from django.core.cache import cache

        cache.clear()
        self.tenant = make_tenant(status=S.TRIAL)
        sub = live_on(self.tenant, make_plan())
        services.update_subscription(
            sub, data={"billing_provider": "fake", "billing_provider_ref": REF}, actor_id=None
        )
        self.tenant = reload(self.tenant)

    def deliver(self, body: bytes, *, secret: str = SECRET, url: str = URL):
        return self.client.post(
            url,
            data=body,
            content_type="application/json",
            HTTP_X_FAKE_SIGNATURE=sign(secret, body, int(time.time())),
        )

    def sub(self):
        return services.live_subscription(self.tenant.pk)

    def test_webhook_bad_signature_401(self) -> None:
        response = self.deliver(event("payment_failed"), secret="not-the-secret")

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED, response.content)
        self.assertEqual(response.json()["error"]["code"], "invalid_signature")
        self.assertEqual(self.sub().status, SUB.ACTIVE)
        self.assertFalse(BillingEventReceipt.objects.exists())
        self.assertTrue(AuditLog.objects.filter(action="billing_event.invalid_signature").exists())

    def test_webhook_finds_tenant_with_nothing_bound(self) -> None:
        paid_through = self.sub().current_period_end + timedelta(days=30)

        response = self.deliver(event("payment_succeeded", paid_through=paid_through))

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertEqual(self.sub().current_period_end, paid_through)
        receipt = BillingEventReceipt.objects.get(provider="fake", event_id="evt_1")
        self.assertEqual(receipt.tenant_id, self.tenant.pk)
        self.assertEqual(receipt.outcome, "applied")
        # A system caller: the service audits without an actor (ruling A3).
        audit = AuditLog.objects.get(tenant_id=self.tenant.pk, action="record_payment")
        self.assertIsNone(audit.actor_id)

    def test_payment_failed_event_moves_to_past_due(self) -> None:
        response = self.deliver(event("payment_failed"))

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertEqual(self.sub().status, SUB.PAST_DUE)
        self.assertEqual(reload(self.tenant).status, S.PAST_DUE)

    def test_webhook_replay_is_noop(self) -> None:
        body = event("payment_failed")
        self.deliver(body)
        paid_through = timezone.now() + timedelta(days=60)
        services.record_payment(self.sub(), paid_through=paid_through, actor_id=None)

        replay = self.deliver(body)

        self.assertEqual(replay.status_code, status.HTTP_200_OK, replay.content)
        # The replayed failure did not undo the payment recorded since.
        self.assertEqual(self.sub().status, SUB.ACTIVE)
        self.assertEqual(BillingEventReceipt.objects.count(), 1)
        self.assertEqual(
            AuditLog.objects.filter(tenant_id=self.tenant.pk, action="mark_payment_failed").count(),
            1,
        )

    def test_an_unknown_reference_is_a_logged_no_op(self) -> None:
        with self.assertLogs("apps.platform_admin.billing", level="WARNING"):
            response = self.deliver(event("payment_failed", ref="cus_nobody"))

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertEqual(self.sub().status, SUB.ACTIVE)
        receipt = BillingEventReceipt.objects.get(event_id="evt_1")
        self.assertIsNone(receipt.tenant_id)
        self.assertEqual(receipt.outcome, "unknown_ref")

    def test_an_event_the_subscription_cannot_take_is_ignored(self) -> None:
        self.deliver(event("payment_failed", event_id="evt_a"))

        again = self.deliver(event("payment_failed", event_id="evt_b"))

        self.assertEqual(again.status_code, status.HTTP_200_OK, again.content)
        self.assertEqual(BillingEventReceipt.objects.get(event_id="evt_b").outcome, "ignored")

    def test_an_unknown_or_disabled_provider_is_404(self) -> None:
        body = event("payment_failed")
        for provider in ("stripe", "manual"):
            with self.subTest(provider=provider):
                response = self.deliver(body, url=f"/api/v1/platform/billing-events/{provider}")
                self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    @override_settings(PLATFORM_BILLING_WEBHOOK_SECRET="")
    def test_no_secret_configured_is_503(self) -> None:
        response = self.deliver(event("payment_failed"), secret="")

        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(self.sub().status, SUB.ACTIVE)
