"""Reads behind the public content API (plan decision 3, "Public API contract").

Every function runs with the tenant already bound by `PublicContentView.bound_tenant`, so RLS
and the tenant-scoped managers confine each query to the host's school. Each returns plain data
in the shape its `Public*` serializer declares; nothing here writes.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from django.db.models import Prefetch, Q

from apps.school_organization.public import primary_campus_contact
from apps.website_cms.constants import (
    DEFAULT_THEME_CODE,
    EVENTS_PATH_PREFIX,
    GALLERY_PATH_PREFIX,
    NEWS_PATH_PREFIX,
    RTL_LANGUAGES,
    NavTargetType,
    TextDirection,
    WebsiteStatus,
)
from apps.website_cms.media import public_file_url, to_public
from apps.website_cms.models import (
    ContentStatus,
    CustomDomain,
    CustomDomainStatus,
    GalleryAlbum,
    MenuLocation,
    NavigationMenu,
    NewsPost,
    PageSection,
    PageType,
    SchoolEvent,
    SeoSetting,
    SeoTargetType,
    Theme,
    WebsitePage,
    WebsiteSettings,
)
from apps.website_cms.validation import as_uuid
from core.tenancy.features import enabled_feature_keys
from core.tenancy.models import Tenant, TenantOwnedModel, TenantSettings

#: The page slugs that ask for the homepage; the renderer sends `home` for `/`.
HOMEPAGE_SLUGS = frozenset({"", "home"})

#: Where the renderer lists each content type; nav "index" targets link here.
INDEX_PATHS: dict[str, str] = {
    NavTargetType.NEWS_INDEX.value: f"/{NEWS_PATH_PREFIX}",
    NavTargetType.EVENTS_INDEX.value: f"/{EVENTS_PATH_PREFIX}",
    NavTargetType.GALLERY_INDEX.value: f"/{GALLERY_PATH_PREFIX}",
}

#: Content types with a page each on the renderer, under their path prefix.
SITEMAP_CONTENT: tuple[tuple[str, type[TenantOwnedModel]], ...] = (
    (NEWS_PATH_PREFIX, NewsPost),
    (EVENTS_PATH_PREFIX, SchoolEvent),
    (GALLERY_PATH_PREFIX, GalleryAlbum),
)


def page_path(slug: str, *, is_homepage: bool) -> str:
    """`/` for the homepage, else `/<slug>`."""
    return "/" if is_homepage else f"/{slug}"


def _settings_row() -> WebsiteSettings | None:
    return WebsiteSettings.objects.alive().select_related("theme").first()


def _theme(row: WebsiteSettings | None) -> Theme | None:
    """The site's theme; a site with no settings row yet previews with the default theme."""
    if row is not None:
        return row.theme
    return Theme.objects.filter(code=DEFAULT_THEME_CODE).first()


def _text(value: str) -> str | None:
    """`""` (the column's "unset") as `None`, so the renderer's `??` fallbacks apply."""
    return value or None


def _seo(row: SeoSetting | None, tenant_id: UUID, *, hidden: bool = False) -> dict[str, Any]:
    robots = row.robots if row else ""
    return {
        "title": _text(row.meta_title) if row else None,
        "description": _text(row.meta_description) if row else None,
        "canonical_url": _text(row.canonical_url) if row else None,
        "og_image_url": (
            public_file_url(tenant_id, row.og_image_file_id)
            if row and row.og_image_file_id
            else None
        ),
        "robots": _text(robots),
        "noindex": hidden or "noindex" in robots.lower(),
    }


# --- tenants/by-host ---------------------------------------------------------------------


def _direction(locale: str) -> str:
    language = locale.split("-")[0].split("_")[0].lower()
    return TextDirection.RTL if language in RTL_LANGUAGES else TextDirection.LTR


def read_tenant(tenant: Tenant, status: WebsiteStatus) -> dict[str, Any]:
    """`PublicTenant`. `status` is the site's state, already resolved by the caller."""
    settings_row = WebsiteSettings.objects.alive().values("default_locale").first()
    default_locale = (settings_row or {}).get("default_locale") or tenant.locale
    branding = (
        TenantSettings.objects.filter(tenant_id=tenant.pk)
        .values_list("branding", flat=True)
        .first()
    )
    contact = primary_campus_contact()
    custom_domain = (
        CustomDomain.objects.alive()
        .filter(is_primary=True, status=CustomDomainStatus.ACTIVE)
        .values_list("domain", flat=True)
        .first()
    )
    return {
        "id": tenant.pk,
        "slug": tenant.slug,
        "name": tenant.name,
        "status": tenant.status,
        "website_status": status,
        "branding": branding if isinstance(branding, dict) else {},
        "locale": {
            "default_locale": default_locale,
            # v1 is single-locale (deferred-work: multi-locale content).
            "enabled_locales": [default_locale],
            "timezone": tenant.timezone,
            "direction": _direction(default_locale),
        },
        "contact": (
            {
                "campus_name": contact.campus_name,
                "address": contact.address,
                "phone": contact.phone,
                "email": contact.email,
            }
            if contact
            else None
        ),
        "custom_domain": custom_domain,
        "enabled_modules": enabled_feature_keys(tenant_id=tenant.pk, prefix="module."),
    }


# --- site --------------------------------------------------------------------------------


def _menu_page_ids(items: list[dict[str, Any]], found: set[UUID]) -> None:
    for item in items:
        if item.get("target_type") == NavTargetType.PAGE and (pid := as_uuid(item.get("target"))):
            found.add(pid)
        _menu_page_ids(item.get("children") or [], found)


def _nav_items(
    items: list[dict[str, Any]], paths: dict[UUID, str], *, nested: bool = False
) -> list[dict[str, Any]]:
    """Items as `{label, href, children}`. An unpublished page target drops with its subtree."""
    out: list[dict[str, Any]] = []
    for item in items:
        target_type = item.get("target_type")
        href: str | None
        if target_type == NavTargetType.PAGE:
            pid = as_uuid(item.get("target"))
            href = paths.get(pid) if pid else None
        elif target_type == NavTargetType.URL:
            href = item.get("target") or None
        else:
            href = INDEX_PATHS.get(str(target_type))
        if href is None:
            continue
        row: dict[str, Any] = {"label": item.get("label", ""), "href": href}
        if not nested:
            row["children"] = _nav_items(item.get("children") or [], paths, nested=True)
        out.append(row)
    return out


def read_site(tenant: Tenant) -> dict[str, Any]:
    """`PublicSite`: theme, navigation, header/footer config, social links and site SEO."""
    row = _settings_row()
    theme = _theme(row)
    menus = {menu.location: menu.items or [] for menu in NavigationMenu.objects.alive()}
    wanted: set[UUID] = set()
    for items in menus.values():
        _menu_page_ids(items, wanted)
    paths = {
        page.id: page_path(page.slug, is_homepage=page.page_type == PageType.HOME)
        for page in WebsitePage.objects.alive()
        .filter(id__in=wanted, status=ContentStatus.PUBLISHED)
        .only("id", "slug", "page_type")
    }
    site_seo = SeoSetting.objects.alive().filter(target_type=SeoTargetType.SITE).first()
    config = row.theme_config if row else {}
    return {
        "theme": {
            "code": theme.code if theme else DEFAULT_THEME_CODE,
            "version": theme.version if theme else "",
            "config": to_public(theme.config_schema, config, tenant.pk) if theme else {},
        },
        "navigation": {
            location: _nav_items(menus.get(location, []), paths) for location in MenuLocation.values
        },
        "header_config": row.header_config if row else {},
        "footer_config": row.footer_config if row else {},
        "social_links": [
            {"platform": link.get("platform", ""), "url": link.get("url", "")}
            for link in (row.social_links if row else [])
            if isinstance(link, dict) and link.get("url")
        ],
        "seo": _seo(site_seo, tenant.pk),
    }


# --- pages -------------------------------------------------------------------------------


def read_page(tenant: Tenant, slug: str, *, preview_page_id: UUID | None) -> dict[str, Any] | None:
    """`PublicPage` for `slug`, or `None`.

    Without a preview only a published page is found. With one, only the page the token names
    is, in any live status, so a token never opens a different page.
    """
    slug = slug.strip("/")
    pages = WebsitePage.objects.alive()
    query = Q(page_type=PageType.HOME) if slug in HOMEPAGE_SLUGS else Q(slug=slug)
    if preview_page_id is None:
        pages = pages.filter(status=ContentStatus.PUBLISHED)
    else:
        pages = pages.filter(id=preview_page_id)
    visible = PageSection.objects.alive().filter(is_visible=True).order_by("position", "id")
    page = (
        pages.filter(query)
        .prefetch_related(Prefetch("sections", queryset=visible))
        .order_by("locale", "id")
        .first()
    )
    if page is None:
        return None
    theme = _theme(_settings_row())
    section_types: dict[str, Any] = (theme.section_types if theme else None) or {}
    sections = []
    for section in page.sections.all():
        entry = section_types.get(section.section_type)
        # A type the current theme does not declare has no schema to render against.
        if entry is None:
            continue
        sections.append(
            {
                "id": section.id,
                "type": section.section_type,
                "position": section.position,
                "props": to_public(entry["schema"], section.content, tenant.pk),
            }
        )
    seo = (
        SeoSetting.objects.alive().filter(target_type=SeoTargetType.PAGE, target_id=page.id).first()
    )
    is_homepage = page.page_type == PageType.HOME
    return {
        "id": page.id,
        "slug": page.slug,
        "path": page_path(page.slug, is_homepage=is_homepage),
        "title": page.title,
        "page_type": page.page_type,
        "status": page.status,
        "is_homepage": is_homepage,
        "published_at": page.published_at,
        "updated_at": page.updated_at,
        "sections": sections,
        "seo": _seo(seo, tenant.pk, hidden=not page.show_in_search),
    }


# --- sitemap -----------------------------------------------------------------------------


def read_sitemap() -> list[dict[str, Any]]:
    """`[{path, updated_at}]`: published pages shown in search, then posts, events, albums.

    One query per content type, ordered by path within each.
    """
    entries = [
        {
            "path": page_path(slug, is_homepage=page_type == PageType.HOME),
            "updated_at": updated,
        }
        for slug, page_type, updated in WebsitePage.objects.alive()
        .filter(status=ContentStatus.PUBLISHED, show_in_search=True)
        .order_by("slug", "id")
        .values_list("slug", "page_type", "updated_at")
    ]
    for prefix, model in SITEMAP_CONTENT:
        rows = (
            model.objects.alive()
            .filter(status=ContentStatus.PUBLISHED)
            .order_by("slug", "id")
            .values_list("slug", "updated_at")
        )
        entries.extend(
            {"path": f"/{prefix}/{slug}", "updated_at": updated} for slug, updated in rows
        )
    return entries
