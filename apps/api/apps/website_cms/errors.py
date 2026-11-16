"""One shape for the module's business-rule 422s and reasoned 409s."""

from __future__ import annotations

from core.api.exceptions import Conflict, DomainRuleViolation


class ReasonedConflict(Conflict):
    """A 409 whose `meta.reason` names the conflict for clients, as a 422's does."""

    def __init__(self, detail=None, code=None, *, meta: dict | None = None) -> None:
        super().__init__(detail, code)
        self.meta = meta


def violation(field: str, reason: str, message: str) -> DomainRuleViolation:
    """A 422 whose detail is `<reason>: <message>` under `field` (bare if empty)."""
    text = f"{reason}: {message}"
    return DomainRuleViolation({field: text} if field else text, meta={"reason": reason})


def conflict(field: str, reason: str, message: str) -> ReasonedConflict:
    """A 409 in the same shape: `<reason>: <message>` under `field`, `reason` in `meta`."""
    return ReasonedConflict({field: f"{reason}: {message}"}, meta={"reason": reason})
