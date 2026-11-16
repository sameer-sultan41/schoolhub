"""Which subscription state a tenant is in, answered by a registered hook.

Reinstating a suspended school returns it to the status its live subscription implies
(multi-tenancy.md §7). Subscriptions belong to the platform console's app, and ``core``
imports no app (ADR-0013), so that app registers a resolver from ``AppConfig.ready()``, the
way modules register invitation eligibility checks.

With no resolver registered, or one that finds no live subscription, the answer is
``None``: the caller decides what that means (``:reinstate`` then allows only a fresh trial).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from core.tenancy.models import Tenant

TRIALING = "trialing"
ACTIVE = "active"
PAST_DUE = "past_due"
#: The states of a live subscription: at most one per tenant is in one of them.
LIVE_STATES = frozenset({TRIALING, ACTIVE, PAST_DUE})

type SubscriptionStateResolver = Callable[[Tenant], str | None]

# At most one entry, keyed so a test can swap it with `mock.patch.dict`.
_hooks: dict[str, SubscriptionStateResolver] = {}
_KEY = "resolver"


def register_subscription_state(fn: SubscriptionStateResolver) -> None:
    """Register the resolver. A second, different one is a bug: two apps would disagree."""
    existing = _hooks.get(_KEY)
    if existing is not None and existing is not fn:
        raise ValueError("A subscription state resolver is already registered.")
    _hooks[_KEY] = fn


def live_subscription_state(tenant: Tenant) -> str | None:
    """``trialing``, ``active`` or ``past_due`` for a live subscription, else ``None``.

    Any other answer from the resolver is treated as no live subscription.
    """
    resolver = _hooks.get(_KEY)
    if resolver is None:
        return None
    state = resolver(tenant)
    return state if state in LIVE_STATES else None
