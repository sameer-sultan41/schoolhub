"""What published website content still references a file (decision 4's reference providers).

One small function per content type; `core.files.visibility` unions their answers. Each takes
the candidate ids and loads only rows that can mention them (lesson L71), never every published row.
"""

from __future__ import annotations

from collections.abc import Callable
from functools import reduce
from operator import or_
from uuid import UUID

from django.db.models import Q

from apps.website_cms.constants import DEFAULT_THEME_CODE
from apps.website_cms.models import (
    ContentStatus,
    GalleryAlbum,
    GalleryItem,
    NewsPost,
    PageSection,
    SchoolEvent,
    SeoSetting,
    SeoTargetType,
    Theme,
    WebsitePage,
    WebsiteSettings,
)
from apps.website_cms.validation import referenced_file_ids, rich_text_file_ids
from core.files.visibility import register_public_reference_provider
from core.tenancy.models import TenantOwnedModel


def _active_section_types() -> dict:
    """The current tenant's theme catalogue, falling back to the default theme."""
    settings = WebsiteSettings.objects.alive().select_related("theme").first()
    theme = settings.theme if settings else Theme.objects.filter(code=DEFAULT_THEME_CODE).first()
    return (theme.section_types if theme else None) or {}


def page_section_files(candidates: set[UUID]) -> set[UUID]:
    """Files in visible sections of published pages."""
    if not candidates:
        return set()
    section_types = _active_section_types()
    # The text match only narrows the rows loaded (a superset); the schema walk confirms.
    mentions = reduce(or_, (Q(content__icontains=str(file_id)) for file_id in candidates))
    sections = PageSection.objects.alive().filter(
        mentions,
        is_visible=True,
        website_page__status=ContentStatus.PUBLISHED,
        website_page__deleted_at__isnull=True,
    )
    found: set[UUID] = set()
    for section in sections:
        entry = section_types.get(section.section_type)
        if entry is not None:
            found |= referenced_file_ids(entry["schema"], section.content) & candidates
    return found


def _published_ids(model: type[TenantOwnedModel], ids: set[UUID | None]) -> set[UUID]:
    """The subset of `ids` that name a live, published row of `model`."""
    return set(
        model.objects.alive()
        .filter(id__in=ids, status=ContentStatus.PUBLISHED)
        .values_list("id", flat=True)
    )


def seo_image_files(candidates: set[UUID]) -> set[UUID]:
    """OG images of the site, or of a published page, post, event or album."""
    rows = list(SeoSetting.objects.alive().filter(og_image_file_id__in=candidates))
    targets = {
        SeoTargetType.PAGE: WebsitePage,
        SeoTargetType.NEWS_POST: NewsPost,
        SeoTargetType.SCHOOL_EVENT: SchoolEvent,
        SeoTargetType.GALLERY_ALBUM: GalleryAlbum,
    }
    published = {
        target_type: _published_ids(
            model, {row.target_id for row in rows if row.target_type == target_type}
        )
        for target_type, model in targets.items()
    }
    return {
        row.og_image_file_id
        for row in rows
        if row.og_image_file_id is not None
        and (
            row.target_type == SeoTargetType.SITE
            or row.target_id in published.get(row.target_type, set())
        )
    }


def _rich_text_files(
    model: type[NewsPost] | type[SchoolEvent], field: str, candidates: set[UUID]
) -> set[UUID]:
    """Cover images and rich-text images of the published rows of `model`."""
    covers = set(
        model.objects.alive()
        .filter(status=ContentStatus.PUBLISHED, cover_image_file_id__in=candidates)
        .values_list("cover_image_file_id", flat=True)
    )
    mentions = reduce(or_, (Q(**{f"{field}__icontains": str(i)}) for i in candidates))
    found: set[UUID] = {c for c in covers if c is not None}
    for row in model.objects.alive().filter(mentions, status=ContentStatus.PUBLISHED):
        found |= rich_text_file_ids(getattr(row, field)) & candidates
    return found


def news_files(candidates: set[UUID]) -> set[UUID]:
    """Covers and body images of published news posts."""
    return _rich_text_files(NewsPost, "body", candidates) if candidates else set()


def event_files(candidates: set[UUID]) -> set[UUID]:
    """Covers and description images of published events."""
    return _rich_text_files(SchoolEvent, "description", candidates) if candidates else set()


def gallery_files(candidates: set[UUID]) -> set[UUID]:
    """Covers and image items of published albums."""
    if not candidates:
        return set()
    published = GalleryAlbum.objects.alive().filter(status=ContentStatus.PUBLISHED)
    covers = published.filter(cover_image_file_id__in=candidates).values_list(
        "cover_image_file_id", flat=True
    )
    items = (
        GalleryItem.objects.alive()
        .filter(file_id__in=candidates, gallery_album__in=published)
        .values_list("file_id", flat=True)
    )
    return {i for i in (*covers, *items) if i is not None}


PROVIDERS: tuple[Callable[[set[UUID]], set[UUID]], ...] = (
    page_section_files,
    seo_image_files,
    news_files,
    event_files,
    gallery_files,
)


def register_providers() -> None:
    for provider in PROVIDERS:
        register_public_reference_provider(provider)
