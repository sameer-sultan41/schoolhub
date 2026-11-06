"""The fake adapter's signed callbacks and the provider registry."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from decimal import Decimal

from django.test import SimpleTestCase, override_settings

from core.integrations.payments.base import CheckoutRequest, InvalidSignature
from core.integrations.payments.fake import SIGNATURE_HEADER, FakeAdapter, sign
from core.integrations.payments.registry import adapter_for

CREDENTIALS = {"merchant_id": "M-12345", "secret": "test-secret"}
NOW = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
ORDER_ID = "SH-INV-1-abcd1234"
BODY = json.dumps(
    {
        "order_id": "SH-INV-1-abcd1234",
        "provider_txn_id": "T-1",
        "status": "paid",
        "amount": "1500.00",
        "occurred_at": "2026-11-07T11:59:00+00:00",
    }
).encode()


def _headers(body: bytes, timestamp: int, secret: str) -> dict[str, str]:
    return {SIGNATURE_HEADER: sign(secret, body, timestamp)}


class FakeAdapterTests(SimpleTestCase):
    def test_fake_signature_verifies_and_rejects_tampered_body(self) -> None:
        adapter = FakeAdapter()
        headers = _headers(BODY, int(NOW.timestamp()), CREDENTIALS["secret"])

        event = adapter.verify_callback(headers, BODY, CREDENTIALS, NOW)

        self.assertEqual(event.order_id, "SH-INV-1-abcd1234")
        self.assertEqual(event.status, "paid")
        tampered = BODY.replace(b"1500.00", b"1.00")
        with self.assertRaises(InvalidSignature):
            adapter.verify_callback(headers, tampered, CREDENTIALS, NOW)
        with self.assertRaises(InvalidSignature):
            adapter.verify_callback(
                _headers(BODY, int(NOW.timestamp()), secret="other"), BODY, CREDENTIALS, NOW
            )

    def _checkout(self) -> CheckoutRequest:
        return CheckoutRequest(
            order_id=ORDER_ID,
            amount=Decimal("1500.00"),
            currency="PKR",
            description="Fee invoice INV-1",
            return_url="https://school.example/portal/fees",
            callback_url="https://api.example/callback",
        )

    @override_settings(PAYMENT_FAKE_SETTLES_ON_INITIATE=False)
    def test_initiate_records_nothing_by_default(self) -> None:
        adapter = FakeAdapter()

        adapter.initiate(self._checkout(), CREDENTIALS)

        self.assertIsNone(adapter.fetch_transaction(CREDENTIALS, ORDER_ID))

    @override_settings(PAYMENT_FAKE_SETTLES_ON_INITIATE=True)
    def test_initiate_settles_when_dev_setting_is_on(self) -> None:
        adapter = FakeAdapter()

        adapter.initiate(self._checkout(), CREDENTIALS)

        event = adapter.fetch_transaction(CREDENTIALS, ORDER_ID)
        assert event is not None
        self.assertEqual(event.status, "paid")
        self.assertEqual(event.amount, Decimal("1500.00"))

    def test_fake_signature_rejects_stale_timestamp(self) -> None:
        adapter = FakeAdapter()
        stale = int(NOW.timestamp()) - 301

        with self.assertRaises(InvalidSignature):
            headers = _headers(BODY, stale, CREDENTIALS["secret"])
            adapter.verify_callback(headers, BODY, CREDENTIALS, NOW)


class RegistryTests(SimpleTestCase):
    @override_settings(PAYMENT_PROVIDERS_ENABLED=[])
    def test_adapter_for_disabled_provider_raises(self) -> None:
        with self.assertRaises(LookupError):
            adapter_for("fake")

    @override_settings(PAYMENT_PROVIDERS_ENABLED=["fake"])
    def test_adapter_for_enabled_provider_returns_it(self) -> None:
        self.assertEqual(adapter_for("fake").provider, "fake")
