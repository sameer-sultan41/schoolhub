"""The per-user preference matrix — cache-backed read/evict."""

from __future__ import annotations

import uuid

from django.core.cache import cache

from apps.communication.features import FEATURE
from core.notifications.models import NotificationCategory, NotificationChannel
from core.tenancy.features import is_feature_enabled

#: Not private — imported by `resolver.py`'s `bulk_is_channel_enabled`, which
#: reads/writes the same cache keys (via `preference_cache_key` below) and
#: must agree on TTL.
PREFERENCE_CACHE_TTL = 300


def preference_cache_key(*, tenant_id: uuid.UUID, user_id: uuid.UUID) -> str:
    """The one place this key is built — `_preference_matrix`,
    `evict_preference_cache` and `resolver.bulk_is_channel_enabled` must all
    agree on it, or a write from one and a read from another silently miss.
    """
    return f"notif-pref:{tenant_id}:{user_id}"


def _preference_matrix(*, user_id: uuid.UUID, tenant_id: uuid.UUID) -> dict[tuple[str, str], bool]:
    """The single-user path, for `materialize_preference_matrix`/`GET
    /notification-preferences` — a viewer's own settings page, not a fan-out, so
    the batch shape `resolver.bulk_is_channel_enabled` needs would only add
    complexity here.
    """
    if not is_feature_enabled(FEATURE, tenant_id=tenant_id):
        return {}

    from apps.communication.models import NotificationPreference

    cache_key = preference_cache_key(tenant_id=tenant_id, user_id=user_id)
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    rows = NotificationPreference.objects.filter(tenant_id=tenant_id, user_id=user_id).values_list(
        "event_category", "channel", "is_enabled"
    )
    matrix = {(category, channel): is_enabled for category, channel, is_enabled in rows}
    cache.set(cache_key, matrix, PREFERENCE_CACHE_TTL)
    return matrix


def evict_preference_cache(*, user_id: uuid.UUID, tenant_id: uuid.UUID) -> None:
    cache.delete(preference_cache_key(tenant_id=tenant_id, user_id=user_id))


def materialize_preference_matrix(*, user_id: uuid.UUID, tenant_id: uuid.UUID) -> list[dict]:
    """Every (category, channel) pair, stored rows overlaid on the `True` default.

    `GET /notification-preferences` returns this rather than the bare stored
    rows, so a client never has to know "no row" means enabled — the same
    completeness `resolver.bulk_is_channel_enabled`'s own docstring argues
    for, now for the read side instead of the delivery-gating side.
    """
    matrix = _preference_matrix(user_id=user_id, tenant_id=tenant_id)
    return [
        {
            "event_category": category,
            "channel": channel,
            "is_enabled": matrix.get((category, channel), True),
        }
        for category in NotificationCategory.values
        for channel in NotificationChannel.values
    ]
