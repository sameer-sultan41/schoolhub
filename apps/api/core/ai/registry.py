"""The AI feature registry.

Features are code, not data. A module declares each of its AI features in its
own ``ai.py``, beside the context schema it sends (ai-governance.md §1.1), and
``load_module_ai`` imports those modules when the gateway app is ready: the
pattern ``core/files/purposes.py`` uses, so core never imports an app (ADR-0013).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from core.ai.grounding import GroundingContext, ValidationResult

Tier = Literal["fast", "standard"]


@dataclass(frozen=True)
class AIFeature:
    """One AI feature.

    ``flag_key`` is the feature's own flag (default off: the per-tenant opt-in).
    ``tier`` picks the pinned model from settings. ``prompt_version`` is logged on
    every call (ai-governance.md §6), so bump it whenever ``system_prompt`` changes.
    """

    key: str
    flag_key: str
    tier: Tier
    prompt_version: str
    system_prompt: str
    max_output_tokens: int
    validate_output: Callable[[str, GroundingContext], ValidationResult]


class AIFeatureRegistry:
    def __init__(self) -> None:
        self._features: dict[str, AIFeature] = {}

    def register(self, feature: AIFeature) -> AIFeature:
        if feature.key in self._features:
            raise ValueError(f"Duplicate AI feature {feature.key!r}")
        if feature.max_output_tokens <= 0:
            raise ValueError(f"AI feature {feature.key!r} needs a positive max_output_tokens")
        if len(feature.key) > 60 or len(feature.prompt_version) > 40:
            raise ValueError(f"AI feature {feature.key!r} has a key or prompt_version too long")
        self._features[feature.key] = feature
        return feature

    def get(self, key: str) -> AIFeature:
        try:
            return self._features[key]
        except KeyError:
            raise LookupError(f"No AI feature {key!r} is registered") from None

    def all(self) -> list[AIFeature]:
        return sorted(self._features.values(), key=lambda feature: feature.key)

    def keys(self) -> set[str]:
        return set(self._features)

    def __contains__(self, key: str) -> bool:
        return key in self._features


registry = AIFeatureRegistry()


def load_module_ai() -> None:
    """Import every installed app's ``ai`` module so its features self-register."""
    from django.apps import apps
    from django.utils.module_loading import module_has_submodule

    for config in apps.get_app_configs():
        if module_has_submodule(config.module, "ai"):
            __import__(f"{config.name}.ai")
