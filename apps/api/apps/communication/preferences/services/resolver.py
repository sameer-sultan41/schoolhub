"""The batch preference resolver registered with `core.notifications`."""

from __future__ import annotations

import uuid

from django.core.cache import cache

from apps.communication.features import FEATURE
from apps.communication.preferences.services.matrix import PREFERENCE_CACHE_TTL
from core.tenancy.features import is_feature_enabled


def bulk_is_channel_enabled(
    user_ids: list[uuid.UUID], event_category: str, channel: str, tenant_id: uuid.UUID
) -> dict[uuid.UUID, bool]:
    """Registered as `core.notifications.services`'s preference resolver.

    Batch-shaped — one call per (channel, fan-out), not one per (recipient,
    channel): a per-item resolver was tried first and reverted, because
    `_delivery_for` calls it once per row in `notify()`'s bulk-insert
    comprehension, which reintroduced exactly the round-trip-per-recipient cost
    `resolve_addresses` already avoids for email. Per-user cache is checked
    first (`cache.get_many`), so a recipient whose matrix was already cached
    from an earlier `notify()` call costs nothing here; only the misses reach
    the table, in one query for the whole set. A missing key in the returned
    map means enabled — see `NotificationPreference`'s docstring for why "no
    row" must not mean "ask again every time".
    """
    if not is_feature_enabled(FEATURE, tenant_id=tenant_id):
        return {}

    from apps.communication.models import NotificationPreference

    cache_keys = {user_id: f"notif-pref:{tenant_id}:{user_id}" for user_id in user_ids}
    cached = cache.get_many(cache_keys.values())

    result: dict[uuid.UUID, bool] = {}
    missing: list[uuid.UUID] = []
    for user_id in user_ids:
        matrix = cached.get(cache_keys[user_id])
        if matrix is None:
            missing.append(user_id)
        else:
            result[user_id] = matrix.get((event_category, channel), True)

    if missing:
        rows = NotificationPreference.objects.filter(
            tenant_id=tenant_id, user_id__in=missing
        ).values_list("user_id", "event_category", "channel", "is_enabled")
        by_user: dict[uuid.UUID, dict[tuple[str, str], bool]] = {user_id: {} for user_id in missing}
        for user_id, category, ch, is_enabled in rows:
            by_user[user_id][(category, ch)] = is_enabled
        cache.set_many(
            {cache_keys[user_id]: matrix for user_id, matrix in by_user.items()},
            PREFERENCE_CACHE_TTL,
        )
        for user_id, matrix in by_user.items():
            result[user_id] = matrix.get((event_category, channel), True)

    return result
