"""The `/school-settings` write: the school's name, its logo, branding and configuration."""

from __future__ import annotations

import uuid

from django.db import transaction

from apps.school_organization.uploads import SCHOOL_LOGO
from core.api.exceptions import DomainRuleViolation
from core.files.models import File, FileStatus
from core.files.services import get_display_url
from core.tenancy.models import Tenant, TenantSettings

#: One message for every unusable id (unknown, another school's, another purpose, still
#: pending), so a caller cannot probe which file ids exist in other tenants.
LOGO_NOT_USABLE = "This file is not a ready school logo upload."

TENANT_FIELDS = ("name", "timezone", "locale", "currency")


def resolve_logo(file_id: uuid.UUID | None, *, current_id: uuid.UUID | None) -> File | None:
    """The `File` a PATCH may set as the logo, or a 422.

    The tenant-scoped manager (and RLS beneath it) hides another school's file, so it is
    indistinguishable from an unknown id. The current logo passes unchecked: a form that
    re-sends it unchanged is not choosing it again.
    """
    if file_id is None:
        return None
    files = File.objects.alive().filter(pk=file_id)
    if file_id != current_id:
        files = files.filter(purpose=SCHOOL_LOGO.key, status=FileStatus.READY)
    logo = files.first()
    if logo is None:
        raise DomainRuleViolation({"logo_file_id": LOGO_NOT_USABLE})
    return logo


def represent(tenant: Tenant, settings_row: TenantSettings) -> dict:
    """The audited state: everything the PATCH can change, without the signed link."""
    return {
        "name": tenant.name,
        "logo_file_id": str(settings_row.logo_file_id) if settings_row.logo_file_id else None,
        "branding": settings_row.branding,
        "academic": settings_row.academic,
        "timezone": tenant.timezone,
        "locale": tenant.locale,
        "currency": tenant.currency,
    }


def logo_url(settings_row: TenantSettings) -> str | None:
    return get_display_url(settings_row.logo_file) if settings_row.logo_file else None


@transaction.atomic
def update_school_settings(
    *, tenant: Tenant, settings_row: TenantSettings, changes: dict, actor_id: uuid.UUID
) -> None:
    """Apply a validated PATCH. `branding` merges into the stored keys, never replacing them,
    so a form that edits one colour cannot wipe the rest."""
    if "logo_file_id" in changes:
        settings_row.logo_file = resolve_logo(
            changes["logo_file_id"], current_id=settings_row.logo_file_id
        )
    if "branding" in changes:
        settings_row.branding = {**(settings_row.branding or {}), **changes["branding"]}
    if "academic" in changes:
        settings_row.academic = changes["academic"]
    settings_row.updated_by = actor_id
    settings_row.save()

    tenant_fields = [field for field in TENANT_FIELDS if field in changes]
    for field in tenant_fields:
        setattr(tenant, field, changes[field])
    if tenant_fields:
        tenant.updated_by = actor_id
        tenant.save(update_fields=[*tenant_fields, "updated_by", "updated_at"])
