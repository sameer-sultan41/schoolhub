"""The resolver `apps.py` registers into `core.notifications.templates`.

Kept out of `services.py` on purpose: `core.notifications.templates.resolve()`
calls this on the hot fan-out path inside `notify()`'s transaction, and giving
it its own module makes that one dependency direction — core calling into a
thin, single-purpose lookup — easy to see without reading past business rules
that have nothing to do with it.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from core.notifications.templates import NotificationTemplate

if TYPE_CHECKING:
    from apps.communication.models import NotificationTemplateOverride


def template_from_override(row: NotificationTemplateOverride) -> NotificationTemplate:
    """The (code, channel, subject, body, variables) -> `NotificationTemplate` mapping.

    Shared by `resolve_tenant_template` below and `views.py`'s `:preview` action —
    one place, so the two can never drift on which fields make the dataclass.
    Duck-typed against `core.notifications.templates.NotificationTemplate`: same
    frozen dataclass shape, built fresh here rather than reused as an ORM row,
    since `render()` only needs the four fields.
    """
    return NotificationTemplate(
        code=row.code,
        channel=row.channel,
        subject=row.subject,
        body=row.body,
        variables=frozenset(row.variables),
    )


def resolve_tenant_template(
    code: str, channel: str, locale: str, tenant_id: uuid.UUID
) -> NotificationTemplate | None:
    """Registered as `core.notifications.templates`'s override resolver.

    Returns `None` for "no active override" — the common case, and not an
    error — so `resolve()` falls through to the platform default.

    Trusts ambient tenant context rather than rebinding it, matching this
    module's own `services.resolve_addresses`: `notify()` always runs inside
    the caller's already-tenant-bound transaction in production (every request
    and task binds tenant before touching data), and rebinding to the same
    tenant here would cost a redundant `SET LOCAL` on every fan-out — see
    `services._preference_matrix`'s query-count test for what that costs in
    practice. A caller that invokes this resolver with no tenant bound gets an
    empty result from `TenantScopedManager`, the same fail-closed behaviour
    every other tenant-scoped read on the platform has.

    `.alive()` matters here specifically: `NotificationTemplateOverride.objects`
    (a `TenantScopedManager`) filters only by tenant — `deleted_at` exclusion is
    the caller's job — and a soft delete (the viewset's default `destroy()`)
    leaves `is_active` untouched, so without `.alive()` a deleted override would
    still be found and rendered.

    Gated on the `module.communication` feature flag first: this resolver is
    registered process-wide the moment `apps.communication` is an installed
    Django app, but the flag ships `default_enabled=False` — until a given
    tenant opts in, every `notify()` call for it (from attendance, fees_finance,
    examinations, ...) would otherwise pay this table query for no benefit.
    `is_feature_enabled` is cache-backed, so this trades an uncached query for
    a cached flag check on every call from a tenant that has not enabled the
    module.
    """
    from core.tenancy.features import is_feature_enabled

    if not is_feature_enabled("module.communication", tenant_id=tenant_id):
        return None

    from apps.communication.models import NotificationTemplateOverride

    row = (
        NotificationTemplateOverride.objects.alive()
        .filter(tenant_id=tenant_id, code=code, channel=channel, locale=locale, is_active=True)
        .only("code", "channel", "subject", "body", "variables")
        .first()
    )
    if row is None:
        return None
    return template_from_override(row)
