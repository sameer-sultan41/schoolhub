"""Provider selection. ``settings.AI_PROVIDER`` names the adapter; there is one real one."""

from __future__ import annotations

from django.conf import settings

from core.ai.providers.base import Provider, ProviderResult, ProviderUnavailable

__all__ = ["Provider", "ProviderResult", "ProviderUnavailable", "get_provider"]


def get_provider() -> Provider:
    name = settings.AI_PROVIDER
    if name == "fake":
        from core.ai.providers.fake import fake_provider

        return fake_provider
    if name == "anthropic":
        from core.ai.providers.anthropic import AnthropicProvider

        return AnthropicProvider(api_key=settings.ANTHROPIC_API_KEY)
    raise ValueError(f"Unknown AI_PROVIDER {name!r}")
