"""Write-time validation and persistence for a user's channel preferences."""

from __future__ import annotations

import uuid

from core.api.exceptions import DomainRuleViolation
from core.notifications.models import NotificationCategory


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
