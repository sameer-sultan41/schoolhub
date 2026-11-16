"""One shape for the module's business-rule 422s."""

from __future__ import annotations

from core.api.exceptions import DomainRuleViolation


def violation(field: str, reason: str, message: str) -> DomainRuleViolation:
    """A 422 whose detail is `<reason>: <message>` under `field` (bare if empty)."""
    text = f"{reason}: {message}"
    return DomainRuleViolation({field: text} if field else text, meta={"reason": reason})
