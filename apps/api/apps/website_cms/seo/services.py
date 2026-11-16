"""SEO settings: target resolution and upsert (module doc §11)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from django.db import IntegrityError, transaction

from apps.website_cms.content import TARGET_MODELS
from apps.website_cms.errors import violation
from apps.website_cms.models import SeoSetting, SeoTargetType
from apps.website_cms.revalidation import queue_revalidation
from apps.website_cms.validation import assert_files_usable, is_safe_url
from core.api.exceptions import DomainRuleViolation
from core.files.visibility import sync_file_visibility
from core.tenancy.models import Tenant


def resolve_target(target_type: str, target_id: UUID | None) -> UUID | None:
    """Validate the target for its type and return the `target_id` to store (None for `site`)."""
    if target_type == SeoTargetType.SITE:
        if target_id is not None:
            raise violation("target_id", "invalid_target", "the site takes no target_id.")
        return None
    model = TARGET_MODELS.get(target_type)
    if model is None:
        raise violation("target_type", "unsupported_target", "this target type is not supported.")
    if target_id is None:
        raise violation("target_id", "invalid_target", "target_id is required for this type.")
    if not model.objects.alive().filter(id=target_id).exists():
        raise violation("target_id", "invalid_target", "this target does not exist.")
    return target_id


def get_or_default(target_type: str, target_id: UUID | None) -> SeoSetting:
    """The stored row, or an unsaved default. Writes nothing."""
    target_id = resolve_target(target_type, target_id)
    row = SeoSetting.objects.alive().filter(target_type=target_type, target_id=target_id).first()
    return row or SeoSetting(target_type=target_type, target_id=target_id)


def _validate(data: dict[str, Any]) -> None:
    canonical = data.get("canonical_url")
    if canonical and not is_safe_url(canonical):
        raise DomainRuleViolation(
            {"canonical_url": "invalid_url: must be an https URL or a relative path."},
            meta={"reason": "invalid_url"},
        )
    if data.get("og_image_file_id") is not None:
        assert_files_usable([data["og_image_file_id"]])


def upsert(
    tenant: Tenant,
    target_type: str,
    target_id: UUID | None,
    data: dict[str, Any],
    actor_id: UUID | None,
) -> tuple[SeoSetting, dict[str, Any], bool]:
    """Create or update the target's row; returns it, its prior values and whether it changed."""
    target_id = resolve_target(target_type, target_id)
    _validate(data)
    with transaction.atomic():
        query = (
            SeoSetting.objects.alive()
            .select_for_update()
            .filter(target_type=target_type, target_id=target_id)
        )
        row = query.first()
        created = row is None
        if created:
            try:
                with transaction.atomic():
                    row = SeoSetting.objects.create(
                        tenant=tenant,
                        target_type=target_type,
                        target_id=target_id,
                        created_by=actor_id,
                        updated_by=actor_id,
                    )
            except IntegrityError:
                row, created = query.get(), False
        before = {name: getattr(row, name) for name in data}
        changed_fields = {name for name, value in data.items() if before[name] != value}
        if changed_fields:
            for name in changed_fields:
                setattr(row, name, data[name])
            row.updated_by = actor_id
            row.save()
        changed = created or bool(changed_fields)
        if "og_image_file_id" in changed_fields:
            sync_file_visibility(
                {i for i in (before["og_image_file_id"], row.og_image_file_id) if i is not None}
            )
        if changed:
            queue_revalidation(tenant.pk)
    return row, before, changed
