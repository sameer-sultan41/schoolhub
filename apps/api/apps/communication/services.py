"""Business rules for the communication module. Views and tasks call this, never models directly."""

from __future__ import annotations

import uuid

from django.core.cache import cache

from core.api.exceptions import DomainRuleViolation
from core.notifications.models import NotificationCategory
from core.notifications.templates import registry as platform_templates
from core.notifications.templates import used_placeholders

_PREFERENCE_CACHE_TTL = 300


def assert_override_is_valid(*, code: str, channel: str, subject: str | None, body: str) -> None:
    """A tenant override may only reference variables the platform template declared.

    Reuses `core.notifications.templates.used_placeholders` — the same
    extraction `_assert_placeholders_declared` runs at registration — because an
    editor's proposed text is checked against a *different* template's (the
    platform default's) declared set, so that function's own check (which reads
    a `NotificationTemplate` instance's own `.variables`) does not apply as-is.
    Refuses if the platform itself has no such (code, channel) at all: an
    override cannot exist for a trigger nothing declares.
    """
    platform = platform_templates.get(code, channel)
    if platform is None:
        raise DomainRuleViolation(
            f"No platform template exists for ({code!r}, {channel!r}) to override.",
            meta={"code": code, "channel": channel},
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

    `core.notifications.services._is_channel_enabled` also refuses to even ask
    for emergency, so this is defense in depth against the row existing at all
    with the wrong value, not the only thing standing between a user and it.
    """
    if event_category == NotificationCategory.EMERGENCY and not is_enabled:
        raise DomainRuleViolation(
            "The emergency notification category cannot be disabled.",
            meta={"event_category": event_category},
        )


def is_channel_enabled(
    user_id: uuid.UUID, event_category: str, channel: str, tenant_id: uuid.UUID
) -> bool:
    """Registered as `core.notifications.services`'s preference resolver.

    One query populates the whole per-user matrix, cached — mirrors
    `core.rbac.permissions.user_scopes`'s cache-per-user shape, for the same
    reason: `_delivery_for` calls this once per (channel, recipient) in a
    fan-out of thousands, and a query each would turn preference-checking into
    the N+1 `notify()`'s own docstring already warns a per-recipient render
    would be. A missing row means enabled — see `NotificationPreference`'s
    docstring for why "no row" must not mean "ask again every time".
    """
    matrix = _preference_matrix(user_id=user_id, tenant_id=tenant_id)
    return matrix.get((event_category, channel), True)


def _preference_matrix(*, user_id: uuid.UUID, tenant_id: uuid.UUID) -> dict[tuple[str, str], bool]:
    """Bound to `tenant_id` explicitly — see `resolve_tenant_template`'s docstring
    for why a registered resolver cannot trust ambient tenant context."""
    from apps.communication.models import NotificationPreference
    from core.tenancy.context import tenant_context

    cache_key = f"notif-pref:{tenant_id}:{user_id}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    with tenant_context(tenant_id):
        rows = NotificationPreference.objects.filter(
            tenant_id=tenant_id, user_id=user_id
        ).values_list("event_category", "channel", "is_enabled")
        matrix = {(category, channel): is_enabled for category, channel, is_enabled in rows}
    cache.set(cache_key, matrix, _PREFERENCE_CACHE_TTL)
    return matrix


def evict_preference_cache(*, user_id: uuid.UUID, tenant_id: uuid.UUID) -> None:
    cache.delete(f"notif-pref:{tenant_id}:{user_id}")
