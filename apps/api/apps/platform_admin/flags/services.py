"""Feature-flag console services: a flag's platform default and a school's overrides.

A flag's row is platform scope; an override is the school's own row, under RLS, so every
override write runs with that school bound. Each write invalidates the feature cache, so the
change reaches the school's next request.

A write that would switch a flag off for a school asks the guards other modules registered
(`core.tenancy.features.disable_refusal`) first, and an override that tries to switch a kill
switch on is refused: only the platform default may enable a kill switch (§11). Both refusals
are a 409 ``toggle_refused``.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from django.db import transaction
from django.utils import timezone

from core.api.exceptions import CodedAPIException
from core.audit.services import record_system_audit
from core.tenancy.context import tenant_context
from core.tenancy.features import (
    disable_refusal,
    invalidate_feature_cache,
    resolve_without_override,
)
from core.tenancy.models import FeatureFlag, Tenant, TenantFeatureOverride

KILL_SWITCH_ON = "A kill switch can only be turned on by its platform default, not per school."

# The fields `PATCH /platform/feature-flags/{id}` may change; the key and description are code.
EDITABLE_FIELDS = ("default_enabled", "is_kill_switch")


class ToggleRefused(CodedAPIException):
    status_code = 409
    default_detail = "This flag cannot be switched off for this school."
    default_code = "toggle_refused"


def update_flag(flag: FeatureFlag, *, data: dict) -> FeatureFlag:
    """Change a flag's platform default or kill-switch setting, for every school at once."""
    fields = [field for field in EDITABLE_FIELDS if field in data]
    for field in fields:
        setattr(flag, field, data[field])
    flag.save(update_fields=[*fields, "updated_at"])
    invalidate_feature_cache()
    return flag


def set_override(
    tenant: Tenant,
    flag: FeatureFlag,
    *,
    enabled: bool,
    reason: str,
    expires_at: datetime | None,
    actor_id: uuid.UUID,
) -> TenantFeatureOverride:
    """Give the school an override of ``flag``, replacing any live one it has."""
    if enabled and flag.is_kill_switch:
        raise ToggleRefused(KILL_SWITCH_ON, meta={"flag": flag.key})
    if not enabled:
        _refuse_if_guarded(flag.key, tenant.pk)
    with transaction.atomic(), tenant_context(tenant.pk):
        current = (
            TenantFeatureOverride.objects.select_for_update()
            .filter(feature_flag=flag, deleted_at__isnull=True)
            .first()
        )
        if current is not None:
            _retire(current, actor_id)
        override = TenantFeatureOverride.objects.create(
            tenant=tenant,
            feature_flag=flag,
            enabled=enabled,
            reason=reason,
            expires_at=expires_at,
            created_by=actor_id,
            updated_by=actor_id,
        )
    invalidate_feature_cache()
    return override


def remove_override(override: TenantFeatureOverride, *, actor_id: uuid.UUID) -> None:
    """End the school's override, so the plan or the default decides again.

    Removing an override that kept the flag on is a disable when nothing else enables it,
    so the guards are asked then too.
    """
    key = override.feature_flag.key
    if override.enabled and not resolve_without_override(key, tenant_id=override.tenant_id):
        _refuse_if_guarded(key, override.tenant_id)
    _retire(override, actor_id)
    invalidate_feature_cache()


def lapse_expired_overrides(tenant_id: uuid.UUID) -> int:
    """Retire the bound school's overrides past their ``expires_at``. Returns how many.

    Resolution already ignores an expired override; this clears it from the console's list
    and records the lapse. No guard is asked: the expiry was agreed when it was set.
    """
    expired = TenantFeatureOverride.objects.select_related("feature_flag").filter(
        deleted_at__isnull=True, expires_at__lte=timezone.now()
    )
    count = 0
    for override in expired:
        _retire(override, None)
        record_system_audit(
            tenant_id,
            "lapse",
            override,
            context={"flag": override.feature_flag.key, "enabled": override.enabled},
        )
        count += 1
    if count:
        invalidate_feature_cache()
    return count


def _refuse_if_guarded(key: str, tenant_id: uuid.UUID) -> None:
    reason = disable_refusal(key, tenant_id)
    if reason:
        raise ToggleRefused(reason, meta={"flag": key})


def _retire(override: TenantFeatureOverride, actor_id: uuid.UUID | None) -> None:
    override.deleted_at = timezone.now()
    override.updated_by = actor_id
    override.save(update_fields=["deleted_at", "updated_by", "updated_at"])
