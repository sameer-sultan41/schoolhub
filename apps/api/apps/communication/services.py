"""Business rules for the communication module. Views and tasks call this, never models directly."""

from __future__ import annotations

import uuid

from django.core.cache import cache

from core.api.exceptions import DomainRuleViolation
from core.notifications.models import NotificationCategory, NotificationChannel
from core.notifications.templates import SUBJECTLESS_CHANNELS, used_placeholders
from core.notifications.templates import registry as platform_templates
from core.tenancy.features import is_feature_enabled

FEATURE = "module.communication"

_PREFERENCE_CACHE_TTL = 300


def assert_override_is_valid(*, code: str, channel: str, subject: str | None, body: str) -> None:
    """A tenant override may only reference variables the platform template declared,
    and must match its channel's subject shape.

    Reuses `core.notifications.templates.used_placeholders` — the same
    extraction `_assert_placeholders_declared` runs at registration — because an
    editor's proposed text is checked against a *different* template's (the
    platform default's) declared set, so that function's own check (which reads
    a `NotificationTemplate` instance's own `.variables`) does not apply as-is.
    Refuses if the platform itself has no such (code, channel) at all: an
    override cannot exist for a trigger nothing declares.

    The subject-shape check mirrors `TemplateRegistry.register()`'s own two
    directions for a platform template: SMS/WhatsApp have no title concept and
    must not carry one, and every other channel must. Without this a tenant
    could save an EMAIL/IN_APP override with an empty subject — a notification
    with no title — or an SMS override whose subject silently never renders.
    """
    platform = platform_templates.get(code, channel)
    if platform is None:
        raise DomainRuleViolation(
            f"No platform template exists for ({code!r}, {channel!r}) to override.",
            meta={"code": code, "channel": channel},
        )

    if channel in SUBJECTLESS_CHANNELS and subject:
        raise DomainRuleViolation(
            f"Channel {channel!r} has no subject; this override set one.",
            meta={"channel": channel},
        )
    if channel not in SUBJECTLESS_CHANNELS and not subject:
        raise DomainRuleViolation(
            f"Channel {channel!r} needs a subject.", meta={"channel": channel}
        )

    used = used_placeholders(subject or "", body)
    undeclared = used - platform.variables
    if undeclared:
        raise DomainRuleViolation(
            f"This template uses variables the platform template does not declare: "
            f"{', '.join(sorted(undeclared))}.",
            meta={"undeclared_variables": sorted(undeclared)},
        )


def assert_preference_may_be_saved(*, event_category: str, is_enabled: bool) -> None:
    """§11: the emergency category cannot be disabled — the mandatory floor.

    `core.notifications.services`'s own resolver-call site also refuses to even
    ask for emergency, so this is defense in depth against the row existing at
    all with the wrong value, not the only thing standing between a user and it.
    """
    if event_category == NotificationCategory.EMERGENCY and not is_enabled:
        raise DomainRuleViolation(
            "The emergency notification category cannot be disabled.",
            meta={"event_category": event_category},
        )


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
            _PREFERENCE_CACHE_TTL,
        )
        for user_id, matrix in by_user.items():
            result[user_id] = matrix.get((event_category, channel), True)

    return result


def _preference_matrix(*, user_id: uuid.UUID, tenant_id: uuid.UUID) -> dict[tuple[str, str], bool]:
    """The single-user path, for `materialize_preference_matrix`/`GET
    /notification-preferences` — a viewer's own settings page, not a fan-out, so
    the batch shape `bulk_is_channel_enabled` needs would only add complexity here.
    """
    if not is_feature_enabled(FEATURE, tenant_id=tenant_id):
        return {}

    from apps.communication.models import NotificationPreference

    cache_key = f"notif-pref:{tenant_id}:{user_id}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    rows = NotificationPreference.objects.filter(tenant_id=tenant_id, user_id=user_id).values_list(
        "event_category", "channel", "is_enabled"
    )
    matrix = {(category, channel): is_enabled for category, channel, is_enabled in rows}
    cache.set(cache_key, matrix, _PREFERENCE_CACHE_TTL)
    return matrix


def evict_preference_cache(*, user_id: uuid.UUID, tenant_id: uuid.UUID) -> None:
    cache.delete(f"notif-pref:{tenant_id}:{user_id}")


def materialize_preference_matrix(*, user_id: uuid.UUID, tenant_id: uuid.UUID) -> list[dict]:
    """Every (category, channel) pair, stored rows overlaid on the `True` default.

    `GET /notification-preferences` returns this rather than the bare stored
    rows, so a client never has to know "no row" means enabled — the same
    completeness `bulk_is_channel_enabled`'s own docstring argues for, now for
    the read side instead of the delivery-gating side.
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


def save_preferences(*, user_id: uuid.UUID, tenant_id: uuid.UUID, rows: list[dict]) -> None:
    """Upsert each `{event_category, channel, is_enabled}` row for this user.

    Each row was already validated by `NotificationPreferenceUpdateSerializer`
    (which calls `assert_preference_may_be_saved`), so this is pure persistence —
    the `post_save` signal (`signals.py`) evicts the cache, which is why no
    eviction call appears here.
    """
    from apps.communication.models import NotificationPreference

    for row in rows:
        NotificationPreference.objects.update_or_create(
            tenant_id=tenant_id,
            user_id=user_id,
            event_category=row["event_category"],
            channel=row["channel"],
            defaults={"is_enabled": row["is_enabled"]},
        )
