"""The resolver `apps.py` registers into `core.notifications.templates`.

Kept out of `services.py` on purpose: `core.notifications.templates.resolve()`
calls this on the hot fan-out path inside `notify()`'s transaction, and giving
it its own module makes that one dependency direction — core calling into a
thin, single-purpose lookup — easy to see without reading past business rules
that have nothing to do with it.
"""

from __future__ import annotations

import uuid

from core.notifications.templates import NotificationTemplate


def resolve_tenant_template(
    code: str, channel: str, locale: str, tenant_id: uuid.UUID
) -> NotificationTemplate | None:
    """Registered as `core.notifications.templates`'s override resolver.

    Returns `None` for "no active override" — the common case, and not an
    error — so `resolve()` falls through to the platform default. Duck-typed
    against `core.notifications.templates.NotificationTemplate`: same frozen
    dataclass shape, built fresh here rather than imported as a model instance,
    since `render()` only needs the four fields, not an ORM row.

    Binds `tenant_id` explicitly rather than trusting ambient context: `notify()`
    always runs inside the caller's already-tenant-bound transaction in
    production, but this resolver is a registered callback with no control over
    who calls it or when, and `TenantScopedManager` fails closed (`.none()`) on
    an unbound read rather than raising — silently finding nothing is exactly
    the wrong failure mode for "does this tenant have an override".
    """
    from apps.communication.models import NotificationTemplateOverride
    from core.tenancy.context import tenant_context

    with tenant_context(tenant_id):
        row = (
            NotificationTemplateOverride.objects.filter(
                tenant_id=tenant_id, code=code, channel=channel, locale=locale, is_active=True
            )
            .only("code", "channel", "subject", "body", "variables")
            .first()
        )
    if row is None:
        return None
    return NotificationTemplate(
        code=row.code,
        channel=row.channel,
        subject=row.subject,
        body=row.body,
        variables=frozenset(row.variables),
    )
