"""What published website content still references a file (decision 4's reference providers).

One small function per content type; `core.files.visibility` unions their answers. News, events
and gallery add their own function here and one line to `PROVIDERS`.
"""

from __future__ import annotations

from collections.abc import Callable
from uuid import UUID

from apps.website_cms.models import (
    ContentStatus,
    PageSection,
    SeoSetting,
    SeoTargetType,
    Theme,
    WebsitePage,
    WebsiteSettings,
)
from apps.website_cms.validation import referenced_file_ids
from core.files.visibility import register_public_reference_provider

DEFAULT_THEME_CODE = "default"


def _active_section_types() -> dict:
    """The current tenant's theme catalogue, falling back to the default theme."""
    settings = WebsiteSettings.objects.alive().select_related("theme").first()
    theme = settings.theme if settings else Theme.objects.filter(code=DEFAULT_THEME_CODE).first()
    return (theme.section_types if theme else None) or {}


def page_section_files(candidates: set[UUID]) -> set[UUID]:
    """Files in visible sections of published pages."""
    section_types = _active_section_types()
    sections = PageSection.objects.alive().filter(
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


def seo_image_files(candidates: set[UUID]) -> set[UUID]:
    """OG images of the site, or of a published page."""
    published_pages = set(
        WebsitePage.objects.alive()
        .filter(status=ContentStatus.PUBLISHED)
        .values_list("id", flat=True)
    )
    rows = SeoSetting.objects.alive().filter(og_image_file_id__in=candidates)
    return {
        row.og_image_file_id
        for row in rows
        if row.target_type == SeoTargetType.SITE
        or (row.target_type == SeoTargetType.PAGE and row.target_id in published_pages)
    }


PROVIDERS: tuple[Callable[[set[UUID]], set[UUID]], ...] = (page_section_files, seo_image_files)


def register_providers() -> None:
    for provider in PROVIDERS:
        register_public_reference_provider(provider)
