"""Shared `TenantSettings` row accessor for `school_settings/` and
`holiday_calendar/` — both singleton resources project a different slice of
the same one-row-per-tenant `TenantSettings` (branding/academic JSONB), and
both need to fetch-or-create that row identically.
"""

from __future__ import annotations

from core.tenancy.models import TenantSettings


def get_settings_row(request) -> TenantSettings:
    """One settings row per tenant; provisioning may not have created it yet."""
    row, _ = TenantSettings.objects.get_or_create(
        tenant=request.tenant,
        defaults={"created_by": request.user.pk, "updated_by": request.user.pk},
    )
    return row
