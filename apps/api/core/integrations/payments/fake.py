"""A fake provider for dev, tests and PR 1's end-to-end flow.

It signs like the real aggregators do: ``HMAC-SHA256(secret, f"{timestamp}.{body}")`` in
``X-Fake-Signature: t=<unix>,v1=<hex>``, with a timestamp tolerance (Stripe's webhook
guidance) so a captured callback cannot be replayed later. Transactions live in memory;
tests fill them with ``add_transaction``.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from collections.abc import Mapping
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from django.conf import settings
from django.utils.dateparse import parse_datetime

from core.integrations.payments.base import (
    CheckoutRequest,
    CheckoutSession,
    GatewayEvent,
    InvalidSignature,
)

SIGNATURE_HEADER = "X-Fake-Signature"


def _digest(secret: str, body: bytes, timestamp: int) -> str:
    return hmac.new(
        secret.encode("utf-8"), f"{timestamp}.".encode() + body, hashlib.sha256
    ).hexdigest()


def sign(secret: str, body: bytes, timestamp: int) -> str:
    """The header value a genuine fake-provider callback carries."""
    return f"t={timestamp},v1={_digest(secret, body, timestamp)}"


class FakeAdapter:
    provider = "fake"
    can_reinitiate = False

    def __init__(self) -> None:
        self.transactions: dict[str, GatewayEvent] = {}

    def reset(self) -> None:
        self.transactions.clear()

    def add_transaction(self, event: GatewayEvent) -> None:
        self.transactions[event.order_id] = event

    def mask_merchant_id(self, credentials: Mapping[str, Any]) -> str:
        return "****" + str(credentials.get("merchant_id", ""))[-4:]

    def initiate(self, request: CheckoutRequest, credentials: Mapping[str, Any]) -> CheckoutSession:
        return CheckoutSession(redirect_url=f"https://fake-gateway.invalid/pay/{request.order_id}")

    def verify_callback(
        self,
        headers: Mapping[str, str],
        body: bytes,
        credentials: Mapping[str, Any],
        now: datetime,
    ) -> GatewayEvent:
        lowered = {k.lower(): v for k, v in headers.items()}
        header = lowered.get(SIGNATURE_HEADER.lower(), "")
        try:
            parts = dict(item.split("=", 1) for item in header.split(","))
            timestamp = int(parts["t"])
            presented = parts["v1"]
        except (KeyError, ValueError) as exc:
            raise InvalidSignature("Missing or malformed signature header.") from exc

        expected = _digest(str(credentials.get("secret", "")), body, timestamp)
        if not hmac.compare_digest(expected, presented):
            raise InvalidSignature("Signature mismatch.")
        if abs(now.timestamp() - timestamp) > settings.PAYMENT_CALLBACK_TOLERANCE_SECONDS:
            raise InvalidSignature("Timestamp outside the tolerance.")

        try:
            payload = json.loads(body)
            occurred_at = parse_datetime(payload["occurred_at"])
            if occurred_at is None or payload["status"] not in ("paid", "failed"):
                raise ValueError("bad field")
            return GatewayEvent(
                order_id=payload["order_id"],
                provider_txn_id=payload["provider_txn_id"],
                status=payload["status"],
                amount=Decimal(str(payload["amount"])),
                occurred_at=occurred_at,
                sanitized={
                    key: payload[key] for key in ("order_id", "provider_txn_id", "status", "amount")
                },
            )
        except (ValueError, KeyError, TypeError, InvalidOperation) as exc:
            raise InvalidSignature("Malformed callback body.") from exc

    def fetch_transaction(
        self, credentials: Mapping[str, Any], order_id: str
    ) -> GatewayEvent | None:
        return self.transactions.get(order_id)

    def list_transactions(self, credentials: Mapping[str, Any], day: date) -> list[GatewayEvent]:
        return [e for e in self.transactions.values() if e.occurred_at.date() == day]
