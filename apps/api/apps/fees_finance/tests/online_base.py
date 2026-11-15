"""Shared setup for the online-payment tests (ADR-0034).

On top of `FeesFinanceAPITestCase`: the `fees.online-payments` flag on, one
issued 1000.00 invoice for the guardian's child, the school's gateway account on
the fake provider, and a guardian client holding the portal keys at scope `own`
— the caller `:initiate-payment` is for.

The fake adapter is a process-wide registry entry with an in-memory transaction
store, so it is reset before and after every test; the callback re-fetch reads
that store, so a test states what the provider "knows" with `provider_has`.
"""

from __future__ import annotations

import datetime
import json
import time
from decimal import Decimal

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from apps.fees_finance import services
from apps.fees_finance.models import FeeInvoice, Payment, PaymentGatewayAccount
from apps.fees_finance.tests.base import FeesFinanceAPITestCase
from apps.fees_finance.tests.factories import (
    FeeHeadFactory,
    FeeInvoiceFactory,
    FeeInvoiceLineFactory,
    authenticate,
    enable_feature,
    grant,
)
from core.api.tests.rollback import rollback_as_in_production
from core.integrations.payments.base import GatewayEvent
from core.integrations.payments.fake import SIGNATURE_HEADER, FakeAdapter, sign
from core.integrations.payments.registry import adapter_for
from core.tenancy.context import tenant_context

ONLINE_FEATURE = "fees.online-payments"
MERCHANT_SECRET = "fake-merchant-signing-secret"
CREDENTIALS = {"merchant_id": "MERCHANT-123456", "secret": MERCHANT_SECRET}
PORTAL_PATH = "/portal/fees"
# Django's test client reads headers as WSGI environ keys.
SIGNATURE_META = "HTTP_" + SIGNATURE_HEADER.upper().replace("-", "_")


def fake_adapter() -> FakeAdapter:
    adapter = adapter_for("fake")
    assert isinstance(adapter, FakeAdapter)
    return adapter


def make_account(tenant, actor_id, credentials=None) -> PaymentGatewayAccount:
    with tenant_context(tenant.id):
        return services.save_gateway_account(
            provider="fake",
            credentials=credentials or CREDENTIALS,
            is_active=True,
            actor_id=actor_id,
            tenant_id=tenant.pk,
        )


class OnlinePaymentsTestCase(FeesFinanceAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        # The failure throttle counts in the cache; a previous test's bad
        # signatures must not throttle this one.
        cache.clear()
        # `:initiate-payment` and the callback are `non_atomic_requests` (lesson L67).
        rollback_as_in_production(self)
        self.adapter = fake_adapter()
        self.adapter.reset()
        self.addCleanup(self.adapter.reset)
        enable_feature(self.tenant, ONLINE_FEATURE)

        with tenant_context(self.tenant.id):
            self.head = FeeHeadFactory(tenant=self.tenant, ledger_account=self.fee_income)
            self.invoice = FeeInvoiceFactory(
                tenant=self.tenant,
                student=self.student,
                academic_session=self.session,
                subtotal=Decimal("1000.00"),
                period_label="2026-09",
            )
            FeeInvoiceLineFactory(
                tenant=self.tenant,
                fee_invoice=self.invoice,
                fee_head=self.head,
                amount=Decimal("1000.00"),
            )
        self.account = make_account(self.tenant, self.user.pk)

        grant(
            self.guardian_user,
            "fees.invoice.view",
            "fees.payment.view",
            "fees.payment.pay-online",
            scope="own",
            is_restricted_principal=True,
        )
        self.guardian_client = APIClient()
        authenticate(self.guardian_client, self.guardian_user)

    # ---------------------------------------------------------------- helpers

    def initiate(self, *, invoice=None, key="checkout-1", return_path=PORTAL_PATH, client=None):
        headers = {"HTTP_IDEMPOTENCY_KEY": key} if key else {}
        return (client or self.guardian_client).post(
            f"/api/v1/fee-invoices/{(invoice or self.invoice).pk}:initiate-payment",
            {"return_path": return_path},
            format="json",
            **headers,
        )

    def pending_payment(self, **kwargs) -> Payment:
        response = self.initiate(**kwargs)
        self.assertEqual(response.status_code, 201, response.content)
        with tenant_context(self.tenant.id):
            return Payment.objects.get(pk=response.json()["data"]["payment_id"])

    def provider_has(
        self, payment: Payment, *, status="paid", amount=None, txn="TXN-1"
    ) -> GatewayEvent:
        """Put a transaction in the fake provider's store and return it."""
        event = GatewayEvent(
            order_id=str(payment.reference_no),
            provider_txn_id=txn,
            status=status,
            amount=Decimal(str(amount if amount is not None else payment.amount)),
            occurred_at=timezone.now(),
            sanitized={"order_id": str(payment.reference_no), "status": status},
        )
        self.adapter.add_transaction(event)
        return event

    def callback(
        self,
        event: GatewayEvent,
        *,
        secret=MERCHANT_SECRET,
        timestamp=None,
        slug=None,
        token=None,
        tamper=False,
    ):
        """POST the provider's signed callback for ``event``."""
        body = json.dumps(
            {
                "order_id": event.order_id,
                "provider_txn_id": event.provider_txn_id,
                "status": event.status,
                "amount": str(event.amount),
                "occurred_at": event.occurred_at.isoformat(),
            }
        ).encode()
        signed_at = timestamp if timestamp is not None else int(time.time())
        signature = sign(secret, body, signed_at)
        if tamper:
            body = body.replace(str(event.amount).encode(), b"1.00")
        return APIClient().post(
            f"/api/v1/public/payment-callbacks/{slug or self.tenant.slug}/"
            f"{token or self.account.callback_token}",
            data=body,
            content_type="application/json",
            **{SIGNATURE_META: signature},
        )

    def age(self, payment: Payment, *, minutes: int) -> None:
        """Move a payment's creation back in time, past or within its TTL."""
        with tenant_context(self.tenant.id):
            Payment.objects.filter(pk=payment.pk).update(
                created_at=timezone.now() - datetime.timedelta(minutes=minutes)
            )

    def reload(self, obj):
        with tenant_context(self.tenant.id):
            obj.refresh_from_db()
        return obj

    def invoice_now(self) -> FeeInvoice:
        return self.reload(self.invoice)
