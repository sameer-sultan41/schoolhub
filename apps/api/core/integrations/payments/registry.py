"""Adapter registry. A provider is usable only when registered *and* enabled in settings."""

from __future__ import annotations

from django.conf import settings

from core.integrations.payments.base import PaymentAdapter

_ADAPTERS: dict[str, PaymentAdapter] = {}


def register_adapter(adapter: PaymentAdapter) -> None:
    _ADAPTERS[adapter.provider] = adapter


def enabled_providers() -> list[str]:
    return [p for p in settings.PAYMENT_PROVIDERS_ENABLED if p in _ADAPTERS]


def adapter_for(provider: str) -> PaymentAdapter:
    if provider not in enabled_providers():
        raise LookupError(f"Payment provider {provider!r} is not enabled.")
    return _ADAPTERS[provider]
