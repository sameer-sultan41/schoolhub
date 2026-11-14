"""Per-kind eligibility hooks, re-checked when an invitation is accepted.

An invitation can outlive the reason it was sent: a staff member exits, a guardian loses
their last portal-enabled link, a student withdraws. ``core`` imports no app (ADR-0013),
so each owning app registers a check for its kind from ``AppConfig.ready()``, the same
way modules register permission keys.
"""

from __future__ import annotations

from collections.abc import Callable

from core.rbac.models import User

EligibilityCheck = Callable[[User], bool]

_hooks: dict[str, EligibilityCheck] = {}


def register_invitation_eligibility(kind: str, fn: EligibilityCheck) -> None:
    """Register the check for ``kind``. A second, different check for one kind is a bug."""
    existing = _hooks.get(kind)
    if existing is not None and existing is not fn:
        raise ValueError(f"An eligibility check for {kind!r} invitations is already registered.")
    _hooks[kind] = fn


def is_eligible(user: User, kind: str) -> bool:
    """Whether ``user`` may still accept a ``kind`` invitation. No hook means eligible."""
    check = _hooks.get(kind)
    return True if check is None else bool(check(user))
