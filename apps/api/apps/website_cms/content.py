"""Helpers shared by the news, event and gallery services (module doc §7 and §11)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from django.shortcuts import get_object_or_404

from apps.website_cms.constants import CONTENT_SLUG_MAX_LENGTH, CONTENT_SLUG_RE
from apps.website_cms.errors import violation
from apps.website_cms.models import (
    ContentStatus,
    GalleryAlbum,
    NewsPost,
    SchoolEvent,
    SeoSetting,
    SeoTargetType,
    WebsitePage,
)
from core.api.exceptions import DomainRuleViolation
from core.rbac.permissions import effective_permission_keys
from core.tenancy.models import TenantOwnedModel

#: Each SEO target type's model (`site` has none); a target must be a live row of the tenant.
TARGET_MODELS: dict[str, type[TenantOwnedModel]] = {
    SeoTargetType.PAGE: WebsitePage,
    SeoTargetType.NEWS_POST: NewsPost,
    SeoTargetType.SCHOOL_EVENT: SchoolEvent,
    SeoTargetType.GALLERY_ALBUM: GalleryAlbum,
}


def validate_content_slug(slug: str) -> None:
    """A single lowercase segment of at most 120 characters, else 422."""
    if len(slug) > CONTENT_SLUG_MAX_LENGTH or not CONTENT_SLUG_RE.match(slug):
        raise DomainRuleViolation(
            {"slug": "invalid_slug: use lowercase letters, digits and hyphens."},
            meta={"reason": "invalid_slug"},
        )


def slug_taken() -> DomainRuleViolation:
    return DomainRuleViolation(
        {"slug": "slug_taken: another item already uses this address."},
        meta={"reason": "slug_taken"},
    )


def slug_in_use(model: type[TenantOwnedModel], slug: str, exclude_id: UUID | None = None) -> bool:
    rows = model.objects.alive().filter(slug=slug)
    return rows.exclude(id=exclude_id).exists() if exclude_id else rows.exists()


def locked[RowT: TenantOwnedModel](model: type[RowT], pk: UUID) -> RowT:
    """The row re-read under its row lock, so its status is the committed one (L52)."""
    row: RowT = get_object_or_404(model.objects.alive().select_for_update(), pk=pk)
    return row


def assert_may_edit(status: str, user: Any, publish_key: str) -> None:
    """A published row is edited only by a publisher: the publish gate is the approval (§7.1)."""
    if status == ContentStatus.PUBLISHED and publish_key not in effective_permission_keys(user):
        raise violation(
            "",
            "publish_required",
            f"this is live; editing it needs {publish_key}. Unpublish it first.",
        )


def touch(row: TenantOwnedModel, actor_id: UUID | None, **fields: Any) -> None:
    """Set `fields` and the audit columns, writing only those columns."""
    for name, value in fields.items():
        setattr(row, name, value)
    row.updated_by = actor_id
    row.save(update_fields=[*fields, "updated_by", "updated_at"])


def seo_image_ids(target_type: str, target_id: UUID) -> set[UUID]:
    """The OG image of the target's SEO row, if any."""
    ids = SeoSetting.objects.alive().filter(
        target_type=target_type, target_id=target_id, og_image_file_id__isnull=False
    )
    return {file_id for file_id in ids.values_list("og_image_file_id", flat=True) if file_id}
