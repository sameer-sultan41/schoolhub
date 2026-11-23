"""A fake billing provider for dev and tests, until a real one is chosen (deferred-work.md).

It signs as the fake payment provider does (`core/integrations/payments/fake.py`):
``X-Fake-Signature: t=<unix>,v1=<HMAC-SHA256(secret, f"{t}.{body}")>``, checked against
``PLATFORM_BILLING_WEBHOOK_SECRET`` within ``PAYMENT_CALLBACK_TOLERANCE_SECONDS``, so a
captured event cannot be replayed later. The body is
``{"id", "type", "provider_ref", "paid_through"?}``; a payment must carry ``paid_through``.
"""

from __future__ import annotations

import hmac
import json
from collections.abc import Mapping

from django.conf import settings
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.platform_admin.billing.base import (
    EVENT_KINDS,
    BillingEvent,
    InvalidBillingSignature,
)
from core.integrations.payments.fake import SIGNATURE_HEADER, sign


class FakeBillingAdapter:
    provider = "fake"
    receives_webhooks = True

    def verify_event(self, headers: Mapping[str, str], body: bytes) -> BillingEvent:
        lowered = {key.lower(): value for key, value in headers.items()}
        presented = lowered.get(SIGNATURE_HEADER.lower(), "")
        try:
            parts = dict(item.split("=", 1) for item in presented.split(","))
            timestamp = int(parts["t"])
        except (KeyError, ValueError) as exc:
            raise InvalidBillingSignature("Missing or malformed signature header.") from exc

        expected = sign(settings.PLATFORM_BILLING_WEBHOOK_SECRET, body, timestamp)
        if not hmac.compare_digest(expected, presented):
            raise InvalidBillingSignature("Signature mismatch.")
        age = abs(timezone.now().timestamp() - timestamp)
        if age > settings.PAYMENT_CALLBACK_TOLERANCE_SECONDS:
            raise InvalidBillingSignature("Timestamp outside the tolerance.")

        try:
            payload = json.loads(body)
            kind = payload["type"]
            paid_through = (
                parse_datetime(payload["paid_through"]) if payload.get("paid_through") else None
            )
            if (
                kind not in EVENT_KINDS
                or not payload["id"]
                or not payload["provider_ref"]
                or (kind == "payment_succeeded" and paid_through is None)
            ):
                raise ValueError("bad field")
            return BillingEvent(
                event_id=str(payload["id"]),
                kind=kind,
                provider_ref=str(payload["provider_ref"]),
                paid_through=paid_through,
            )
        except (ValueError, KeyError, TypeError) as exc:
            raise InvalidBillingSignature("Malformed event body.") from exc
