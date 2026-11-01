"""The per-user RBAC cache keys and their eviction: the one place the prefixes live.

A role, permission or assignment change must evict its holders at once, or a revoked
permission keeps working until the TTL runs out. That is a security bug, not staleness.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable

from django.core.cache import cache
from django.db import transaction

SCOPE_GRANTS_PREFIX = "scope-grants"
# `user_scopes`' key; it goes when `user_scopes` does.
USER_SCOPES_PREFIX = "scopes"


def scope_grants_cache_key(user_id: uuid.UUID | str) -> str:
    return f"{SCOPE_GRANTS_PREFIX}:{user_id}"


def user_scopes_cache_key(user_id: uuid.UUID | str) -> str:
    return f"{USER_SCOPES_PREFIX}:{user_id}"


def rbac_cache_keys(user_id: uuid.UUID | str) -> tuple[str, ...]:
    """Every cache key that holds RBAC state for one user."""
    return (scope_grants_cache_key(user_id), user_scopes_cache_key(user_id))


def evict_rbac_caches(user_ids: Iterable[uuid.UUID | str]) -> None:
    """Drop the users' RBAC cache entries now, and again when the transaction commits.

    Now, so the rest of this transaction reads the change. Again on commit, because a
    concurrent request that reads between this eviction and the commit still sees the
    old rows, and would re-cache them for the full TTL. Outside a transaction,
    `on_commit` runs the callback at once.
    """
    keys = [key for user_id in user_ids for key in rbac_cache_keys(user_id)]
    if not keys:
        return
    cache.delete_many(keys)
    transaction.on_commit(lambda: cache.delete_many(keys))
