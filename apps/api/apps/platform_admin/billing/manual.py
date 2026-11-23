"""Manual invoicing (§6, bank-transfer markets): an operator records each payment.

It sends no webhooks; `:record-payment` and `:mark-payment-failed` are its only inputs. It is
registered so that `billing_provider = "manual"` names a known provider.
"""

from __future__ import annotations

from collections.abc import Mapping

from apps.platform_admin.billing.base import BillingEvent, InvalidBillingSignature


class ManualAdapter:
    provider = "manual"
    receives_webhooks = False

    def verify_event(self, headers: Mapping[str, str], body: bytes) -> BillingEvent:
        raise InvalidBillingSignature("Manual billing receives no webhooks.")
