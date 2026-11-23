"""The billing-provider adapter contract (platform-admin.md §17: gateway-agnostic).

An adapter verifies a provider's webhook and turns it into a `BillingEvent`. Nothing else
about a provider reaches the services: they move the subscription the same way whether the
event came from a webhook or an operator's `:record-payment`.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

type BillingEventKind = Literal["payment_succeeded", "payment_failed"]
EVENT_KINDS: tuple[BillingEventKind, ...] = ("payment_succeeded", "payment_failed")


class InvalidBillingSignature(Exception):
    """A webhook failed verification: a bad HMAC, a stale timestamp or a malformed body."""


@dataclass(frozen=True)
class BillingEvent:
    event_id: str
    kind: BillingEventKind
    # The provider's subscription or customer id, as `tenants.billing_provider_ref` holds it.
    provider_ref: str
    # A payment's end of the paid period; None for a failure.
    paid_through: datetime | None


class BillingAdapter(Protocol):
    provider: str
    # False for a provider that sends no webhooks (manual invoicing).
    receives_webhooks: bool

    def verify_event(self, headers: Mapping[str, str], body: bytes) -> BillingEvent:
        """The verified event, or raise `InvalidBillingSignature`."""
        ...
