"""Website settings: the default site and settings updates (plan decision 10, module doc §11)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from django.db import IntegrityError, transaction

from apps.website_cms.constants import DEFAULT_THEME_CODE
from apps.website_cms.defaults import DEFAULT_PAGES
from apps.website_cms.models import (
    PageSection,
    PageType,
    Theme,
    WebsitePage,
    WebsiteSettings,
)
from apps.website_cms.validation import is_safe_url, validate_theme_config
from core.api.exceptions import DomainRuleViolation
from core.tenancy.models import Tenant

#: Keys in header/footer config whose string values are links.
_LINK_KEYS = frozenset({"url", "href"})
#: Settings fields whose change drops the tenant's `by-host` cache entry (decision 8).
HOST_TAG_FIELDS = frozenset({"is_published", "maintenance_mode", "theme_id"})


def default_theme() -> Theme:
    return Theme.objects.get(code=DEFAULT_THEME_CODE)


def unsaved_default(tenant: Tenant) -> WebsiteSettings:
    """What `GET /website-settings` shows before the site exists. Writes nothing."""
    return WebsiteSettings(tenant=tenant, theme=default_theme())


def ensure_default_site(tenant: Tenant, actor_id: UUID | None = None) -> WebsiteSettings:
    """Create the tenant's settings row and standard pages once; safe to call concurrently.

    `get_or_create` against `unique(tenant)` inside a savepoint: the loser of a race waits for
    the winner's commit, hits the constraint, and re-reads. Only the creator seeds the pages.
    Runs in the caller's bound tenant context and transaction.
    """
    existing = WebsiteSettings.objects.alive().select_related("theme").first()
    if existing is not None:
        return existing
    audit = {"created_by": actor_id, "updated_by": actor_id}
    try:
        with transaction.atomic():
            row = WebsiteSettings.objects.create(tenant=tenant, theme=default_theme(), **audit)
            row.homepage_page = _seed_pages(tenant, audit)
            row.save(update_fields=["homepage_page", "updated_at"])
    except IntegrityError:
        return WebsiteSettings.objects.alive().select_related("theme").get()
    return row


def _seed_pages(tenant: Tenant, audit: dict[str, Any]) -> WebsitePage | None:
    """Create the missing standard pages as drafts; returns the home page."""
    taken = set(WebsitePage.objects.alive().values_list("slug", flat=True))
    home = WebsitePage.objects.alive().filter(page_type=PageType.HOME).first()
    pages: list[WebsitePage] = []
    sections: list[PageSection] = []
    for page_type, slug, title, specs in DEFAULT_PAGES:
        if slug in taken or (page_type == PageType.HOME and home is not None):
            continue
        # UUID primary keys are assigned client-side, so pages and sections go in two inserts.
        page = WebsitePage(tenant=tenant, title=title, slug=slug, page_type=page_type, **audit)
        pages.append(page)
        if page_type == PageType.HOME:
            home = page
        sections.extend(
            PageSection(
                tenant=tenant,
                website_page=page,
                section_type=section_type,
                position=position,
                content=content,
                **audit,
            )
            for position, (section_type, content) in enumerate(specs)
        )
    WebsitePage.objects.bulk_create(pages)
    PageSection.objects.bulk_create(sections)
    return home


def _link_errors(value: Any, path: str, errors: dict[str, str]) -> None:
    """Record every unsafe link in a header/footer config tree."""
    if isinstance(value, dict):
        for key, item in value.items():
            where = f"{path}.{key}"
            if key in _LINK_KEYS and isinstance(item, str):
                if not is_safe_url(item):
                    errors[where] = "Must be an https URL or a relative path."
            else:
                _link_errors(item, where, errors)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _link_errors(item, f"{path}.{index}", errors)


def lock_settings(row: WebsiteSettings) -> WebsiteSettings:
    """`row` re-read under its row lock, so a concurrent PATCH cannot be lost."""
    return WebsiteSettings.objects.alive().select_for_update().get(pk=row.pk)


def update_settings(
    row: WebsiteSettings, data: dict[str, Any], actor_id: UUID | None
) -> tuple[WebsiteSettings, set[str]]:
    """Apply a validated PATCH; returns the locked row and the names of the fields that changed.

    Only the changed columns are written, against the row as re-read under its lock.
    """
    row = lock_settings(row)
    errors: dict[str, str] = {}
    theme = row.theme
    if "theme_id" in data and data["theme_id"] != row.theme_id:
        chosen = Theme.objects.filter(id=data["theme_id"], is_active=True).first()
        if chosen is None:
            raise DomainRuleViolation({"theme_id": "Unknown or inactive theme."})
        theme = chosen
    if "theme_config" in data or theme.id != row.theme_id:
        validate_theme_config(theme, data.get("theme_config", row.theme_config))
    if "homepage_page_id" in data and data["homepage_page_id"] is None:
        raise DomainRuleViolation({"homepage_page_id": "A site must keep a home page."})
    if data.get("homepage_page_id") is not None and not (
        WebsitePage.objects.alive()
        .filter(id=data["homepage_page_id"], page_type=PageType.HOME)
        .exists()
    ):
        raise DomainRuleViolation({"homepage_page_id": "Must be this site's home page."})
    for index, link in enumerate(data.get("social_links", [])):
        if not is_safe_url(link["url"]):
            errors[f"social_links.{index}.url"] = "Must be an https URL or a relative path."
    for name in ("header_config", "footer_config"):
        _link_errors(data.get(name), name, errors)
    if errors:
        raise DomainRuleViolation(errors)

    changed: set[str] = set()
    if theme.id != row.theme_id:
        row.theme = theme
        changed.add("theme_id")
    for name, value in data.items():
        if name != "theme_id" and getattr(row, name) != value:
            setattr(row, name, value)
            changed.add(name)
    if changed:
        row.updated_by = actor_id
        row.save(update_fields=[*changed, "updated_by", "updated_at"])
    return row, changed
