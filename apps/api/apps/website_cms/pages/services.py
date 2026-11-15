"""Website pages: slugs, lifecycle, section replacement (module doc §7 and §11).

Every change that can alter which files published content references recomputes file
visibility from the union of the old and new references (plan decision 4), and every change a
visitor can see queues a renderer revalidation.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.website_cms.constants import (
    DEFAULT_THEME_CODE,
    MAX_SECTIONS_PER_PAGE,
    PAGE_SLUG_MAX_LENGTH,
    PAGE_SLUG_RE,
    RESERVED_PAGE_SLUGS,
)
from apps.website_cms.models import (
    ContentStatus,
    NavigationMenu,
    PageSection,
    PageType,
    SeoSetting,
    SeoTargetType,
    Theme,
    WebsitePage,
    WebsiteSettings,
)
from apps.website_cms.revalidation import queue_revalidation
from apps.website_cms.validation import (
    assert_files_usable,
    prefix_details,
    referenced_file_ids,
    validate_section_content,
)
from core.api.exceptions import DomainRuleViolation
from core.files.visibility import sync_file_visibility
from core.tenancy.models import Tenant

#: Added to existing positions first, so `unique(website_page_id, position)` never collides.
POSITION_PARK_OFFSET = 10_000


def _violation(field: str, reason: str, message: str) -> DomainRuleViolation:
    """A 422 whose detail is `<reason>: <message>` under `field`, with `reason` in `meta`."""
    return DomainRuleViolation({field: f"{reason}: {message}"}, meta={"reason": reason})


def _active_theme() -> Theme:
    row = WebsiteSettings.objects.alive().select_related("theme").first()
    return row.theme if row else Theme.objects.get(code=DEFAULT_THEME_CODE)


def validate_slug(slug: str) -> None:
    if len(slug) > PAGE_SLUG_MAX_LENGTH or not PAGE_SLUG_RE.match(slug):
        raise DomainRuleViolation(
            {"slug": "invalid_slug: use lowercase letters, digits and hyphens, joined by '/'."}
        )
    if slug.split("/", 1)[0] in RESERVED_PAGE_SLUGS:
        raise DomainRuleViolation({"slug": "reserved_slug: this address is reserved."})


def _slug_taken() -> DomainRuleViolation:
    return DomainRuleViolation({"slug": "slug_taken: another page already uses this address."})


def _slug_in_use(slug: str, locale: str | None, exclude_id: UUID | None = None) -> bool:
    rows = WebsitePage.objects.alive().filter(slug=slug, locale=locale)
    return rows.exclude(id=exclude_id).exists() if exclude_id else rows.exists()


def create_page(tenant: Tenant, data: dict[str, Any], actor_id: UUID | None) -> WebsitePage:
    validate_slug(data["slug"])
    page_type = data.get("page_type", PageType.STANDARD)
    if page_type == PageType.HOME:
        raise DomainRuleViolation({"page_type": "home_exists: the site has one home page."})
    locale = data.get("locale")
    if _slug_in_use(data["slug"], locale):
        raise _slug_taken()
    try:
        with transaction.atomic():
            return WebsitePage.objects.create(
                tenant=tenant,
                **{**data, "page_type": page_type},
                created_by=actor_id,
                updated_by=actor_id,
            )
    except IntegrityError as exc:
        raise _slug_taken() from exc


def update_page(page: WebsitePage, data: dict[str, Any], actor_id: UUID | None) -> WebsitePage:
    slug = data.get("slug", page.slug)
    locale = data.get("locale", page.locale)
    if (slug, locale) != (page.slug, page.locale):
        validate_slug(slug)
        if _slug_in_use(slug, locale, exclude_id=page.id):
            raise _slug_taken()
    for name, value in data.items():
        setattr(page, name, value)
    page.updated_by = actor_id
    try:
        with transaction.atomic():
            page.save()
    except IntegrityError as exc:
        raise _slug_taken() from exc
    if page.status == ContentStatus.PUBLISHED:
        # A slug or search-visibility change is visible on the live site.
        queue_revalidation(page.tenant_id)
    return page


def page_file_ids(page: WebsitePage) -> set[UUID]:
    """Every file the page references: its sections' images and its own social image."""
    section_types = _active_theme().section_types or {}
    ids: set[UUID] = set()
    for section in PageSection.objects.alive().filter(website_page=page):
        entry = section_types.get(section.section_type)
        if entry is not None:
            ids |= referenced_file_ids(entry["schema"], section.content)
    ids |= {
        file_id
        for file_id in SeoSetting.objects.alive()
        .filter(target_type=SeoTargetType.PAGE, target_id=page.id)
        .values_list("og_image_file_id", flat=True)
        if file_id is not None
    }
    return ids


def _navigation_targets(items: list[dict[str, Any]]) -> set[str]:
    found: set[str] = set()
    for item in items or []:
        if item.get("target_type") == "page" and item.get("target"):
            found.add(str(item["target"]))
        found |= _navigation_targets(item.get("children") or [])
    return found


def page_in_use_reason(page: WebsitePage) -> str | None:
    """Why the page cannot go away, or None: it is the homepage or a menu target."""
    homepage_id = WebsiteSettings.objects.alive().values_list("homepage_page_id", flat=True).first()
    if page.page_type == PageType.HOME or homepage_id == page.id:
        return "it is the homepage"
    for menu in NavigationMenu.objects.alive():
        if str(page.id) in _navigation_targets(menu.items):
            return f"it is linked from the {menu.location} menu"
    return None


def _assert_not_in_use(page: WebsitePage) -> None:
    if (reason := page_in_use_reason(page)) is not None:
        raise _violation("page", "page_in_use", f"this page cannot be removed because {reason}.")


def _touch(page: WebsitePage, actor_id: UUID | None, **fields: Any) -> None:
    for name, value in fields.items():
        setattr(page, name, value)
    page.updated_by = actor_id
    page.save(update_fields=[*fields, "updated_by", "updated_at"])


def publish_page(page: WebsitePage, user: Any) -> WebsitePage:
    if page.status == ContentStatus.PUBLISHED:
        return page
    if not PageSection.objects.alive().filter(website_page=page, is_visible=True).exists():
        raise _violation(
            "sections", "no_visible_sections", "add at least one visible section before publishing."
        )
    _touch(page, user.pk, status=ContentStatus.PUBLISHED, published_at=timezone.now())
    sync_file_visibility(page_file_ids(page))
    queue_revalidation(page.tenant_id)
    return page


def unpublish_page(page: WebsitePage, user: Any) -> WebsitePage:
    if page.status != ContentStatus.PUBLISHED:
        return page
    _touch(page, user.pk, status=ContentStatus.DRAFT, published_at=None)
    sync_file_visibility(page_file_ids(page))
    queue_revalidation(page.tenant_id)
    return page


def archive_page(page: WebsitePage, user: Any) -> WebsitePage:
    if page.status == ContentStatus.ARCHIVED:
        return page
    _assert_not_in_use(page)
    was_published = page.status == ContentStatus.PUBLISHED
    _touch(page, user.pk, status=ContentStatus.ARCHIVED, published_at=None)
    if was_published:
        sync_file_visibility(page_file_ids(page))
        queue_revalidation(page.tenant_id)
    return page


def delete_page(page: WebsitePage, user: Any) -> None:
    if page.status == ContentStatus.PUBLISHED:
        raise _violation("status", "unpublish_first", "unpublish this page before deleting it.")
    _assert_not_in_use(page)
    file_ids = page_file_ids(page)
    page.deleted_at = timezone.now()
    page.updated_by = user.pk
    page.save(update_fields=["deleted_at", "updated_by", "updated_at"])
    sync_file_visibility(file_ids)


def _validated_sections(theme: Theme, sections: list[dict[str, Any]]) -> set[UUID]:
    """Validate every section; returns the files they reference. Errors are keyed `sections.<i>`."""
    if len(sections) > MAX_SECTIONS_PER_PAGE:
        raise DomainRuleViolation(
            {"sections": f"too_many_sections: at most {MAX_SECTIONS_PER_PAGE} sections."}
        )
    ids: set[UUID] = set()
    errors: dict[str, Any] = {}
    for index, section in enumerate(sections):
        try:
            validate_section_content(theme, section["section_type"], section["content"])
        except DomainRuleViolation as exc:
            errors.update(prefix_details(exc, f"sections.{index}"))
            continue
        ids |= referenced_file_ids(
            theme.section_types[section["section_type"]]["schema"], section["content"]
        )
    if errors:
        raise DomainRuleViolation(errors)
    assert_files_usable(ids)
    return ids


def replace_sections(
    page: WebsitePage, sections: list[dict[str, Any]], user: Any
) -> list[PageSection]:
    """Make the page's sections exactly `sections`, in order.

    An entry with an `id` of this page's sections is updated; one without is created; a live
    section absent from the list is soft-deleted. Positions are written in two passes so the
    unique position index never sees a collision.
    """
    theme = _active_theme()
    new_ids = _validated_sections(theme, sections)
    with transaction.atomic():
        live = {
            s.id: s
            for s in PageSection.objects.alive().select_for_update().filter(website_page=page)
        }
        wanted = [s["id"] for s in sections if s.get("id") is not None]
        keep = set(wanted)
        if not keep <= live.keys() or len(keep) != len(wanted):
            raise DomainRuleViolation(
                {"sections": "invalid_section_id: ids must be unique sections of this page."}
            )
        old_ids = page_file_ids(page)
        now = timezone.now()
        removed = [i for i in live if i not in keep]
        PageSection.objects.filter(id__in=removed).update(
            deleted_at=now, updated_by=user.pk, updated_at=now
        )
        kept = [live[i] for i in wanted]
        for section in kept:
            section.position += POSITION_PARK_OFFSET
        PageSection.objects.bulk_update(kept, ["position"])

        result: list[PageSection] = []
        created: list[PageSection] = []
        for position, item in enumerate(sections):
            if item.get("id") is not None:
                section = live[item["id"]]
                section.section_type = item["section_type"]
                section.content = item["content"]
                section.is_visible = item["is_visible"]
                section.position = position
                section.updated_by = user.pk
                section.updated_at = now
            else:
                section = PageSection(
                    tenant_id=page.tenant_id,
                    website_page=page,
                    section_type=item["section_type"],
                    content=item["content"],
                    is_visible=item["is_visible"],
                    position=position,
                    created_by=user.pk,
                    updated_by=user.pk,
                )
                created.append(section)
            result.append(section)
        PageSection.objects.bulk_update(
            kept,
            ["section_type", "content", "is_visible", "position", "updated_by", "updated_at"],
        )
        PageSection.objects.bulk_create(created)
        if page.status == ContentStatus.PUBLISHED:
            sync_file_visibility(old_ids | new_ids)
            queue_revalidation(page.tenant_id)
    return result
