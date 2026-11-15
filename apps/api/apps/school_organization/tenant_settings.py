"""Shared `TenantSettings` row accessor for `school_settings/` and
`holiday_calendar/` — both singleton resources project a different slice of
the same one-row-per-tenant `TenantSettings` (branding/academic JSONB), and
both need to fetch-or-create that row identically.
"""

from __future__ import annotations

import uuid

from core.tenancy.models import TenantSettings


def get_settings_row(request) -> TenantSettings:
    """One settings row per tenant; provisioning may not have created it yet."""
    row, _ = TenantSettings.objects.get_or_create(
        tenant=request.tenant,
        defaults={"created_by": request.user.pk, "updated_by": request.user.pk},
    )
    return row


def lock_settings_row(*, tenant_id: uuid.UUID, actor_id: uuid.UUID) -> TenantSettings:
    """The row, fetched or created under `SELECT ... FOR UPDATE`, for a read-modify-write.

    Every writer that merges into the row's JSON takes this lock, so two overlapping writes
    serialise instead of one saving over the other's read. The caller holds the transaction.
    """
    row, _ = TenantSettings.objects.select_for_update().get_or_create(
        tenant_id=tenant_id, defaults={"created_by": actor_id, "updated_by": actor_id}
    )
    return row
