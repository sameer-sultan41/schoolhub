"""Billing adapters. A provider is usable only when registered and enabled in settings.

``PLATFORM_BILLING_PROVIDERS_ENABLED`` is empty by default, as ``PAYMENT_PROVIDERS_ENABLED``
is, so the fake provider is never live in production unless someone enables it.
"""

from __future__ import annotations

from django.conf import settings

from apps.platform_admin.billing.base import BillingAdapter
from apps.platform_admin.billing.fake import FakeBillingAdapter
from apps.platform_admin.billing.manual import ManualAdapter

_ADAPTERS: dict[str, BillingAdapter] = {
    adapter.provider: adapter for adapter in (ManualAdapter(), FakeBillingAdapter())
}


def webhook_adapter(provider: str) -> BillingAdapter | None:
    """The enabled adapter for ``provider`` that receives webhooks, or None."""
    adapter = _ADAPTERS.get(provider)
    if adapter is None or not adapter.receives_webhooks:
        return None
    if provider not in settings.PLATFORM_BILLING_PROVIDERS_ENABLED:
        return None
    return adapter
