"""One shape for the module's business-rule 422s."""

from __future__ import annotations

from core.api.exceptions import DomainRuleViolation


def violation(field: str, reason: str, message: str) -> DomainRuleViolation:
    """A 422 whose detail is `<reason>: <message>` under `field`, with `reason` in `meta`."""
    return DomainRuleViolation({field: f"{reason}: {message}"}, meta={"reason": reason})
