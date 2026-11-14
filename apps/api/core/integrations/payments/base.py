"""The provider-agnostic payment adapter interface.

One adapter per payment aggregator. The money rules (``fees_finance``) only ever see these
types, so adding a provider never touches them. Adapters hold no state of their own: the
school's decrypted credentials are passed into every call.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal, Protocol


class InvalidSignature(Exception):
    """A callback failed verification: bad HMAC, or a timestamp outside the tolerance."""


class GatewayUnavailable(Exception):
    """A transport-level failure talking to the provider (timeout, 5xx, DNS)."""


@dataclass(frozen=True)
class CheckoutRequest:
    order_id: str
    amount: Decimal
    currency: str
    description: str
    return_url: str
    callback_url: str
    customer_email: str | None = None


@dataclass(frozen=True)
class CheckoutSession:
    redirect_url: str
    expires_at: datetime | None = None


@dataclass(frozen=True)
class GatewayEvent:
    order_id: str
    provider_txn_id: str
    status: Literal["paid", "failed"]
    amount: Decimal
    occurred_at: datetime
    # Never holds card data or secrets; safe to persist and audit.
    sanitized: dict[str, Any] = field(default_factory=dict)


class PaymentAdapter(Protocol):
    provider: str
    # Whether the provider lets us start a second checkout for an order that already has one.
    can_reinitiate: bool

    def mask_merchant_id(self, credentials: Mapping[str, Any]) -> str: ...

    def initiate(
        self, request: CheckoutRequest, credentials: Mapping[str, Any]
    ) -> CheckoutSession: ...

    def verify_callback(
        self,
        headers: Mapping[str, str],
        body: bytes,
        credentials: Mapping[str, Any],
        now: datetime,
    ) -> GatewayEvent: ...

    def fetch_transaction(
        self, credentials: Mapping[str, Any], order_id: str
    ) -> GatewayEvent | None: ...

    def list_transactions(
        self, credentials: Mapping[str, Any], day: date
    ) -> list[GatewayEvent]: ...
