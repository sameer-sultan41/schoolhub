"""Models for the website module.

Behaviour: docs/03-modules/website-cms.md. Column-level specs:
docs/05-database/entities/website-cms.md.

Uniqueness is enforced by partial unique indexes on live rows (`deleted_at IS NULL`), so a
soft-deleted slug or menu can be reused (decision 14). Nullable string columns are
NULL-not-blank by design, hence the blanket DJ001 suppression.
"""
# ruff: noqa: DJ001

from __future__ import annotations

from django.db import models

from apps.website_cms.constants import PAGE_SLUG_MAX_LENGTH
from core.tenancy.models import TenantOwnedModel, TimestampedModel


class PageType(models.TextChoices):
    HOME = "home", "Home"
    ABOUT = "about", "About"
    PRINCIPAL_MESSAGE = "principal_message", "Principal message"
    DEPARTMENTS = "departments", "Departments"
    TEACHERS = "teachers", "Teachers"
    CLASSES = "classes", "Classes"
    ADMISSIONS = "admissions", "Admissions"
    CONTACT = "contact", "Contact"
    STANDARD = "standard", "Standard"


class ContentStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    PUBLISHED = "published", "Published"
    ARCHIVED = "archived", "Archived"


class MenuLocation(models.TextChoices):
    HEADER = "header", "Header"
    FOOTER_PRIMARY = "footer_primary", "Footer (primary)"
    FOOTER_SECONDARY = "footer_secondary", "Footer (secondary)"


class SeoTargetType(models.TextChoices):
    SITE = "site", "Site"
    PAGE = "page", "Page"
    NEWS_POST = "news_post", "News post"
    SCHOOL_EVENT = "school_event", "School event"
    GALLERY_ALBUM = "gallery_album", "Gallery album"


class Theme(TimestampedModel):
    """A website theme. Platform scope: no tenant_id, no RLS; tenants reference, never edit.

    Rows are synced from code (`themes/`) on `post_migrate`, never hand-edited.
    """

    name = models.CharField(max_length=100)
    code = models.CharField(max_length=50)
    version = models.CharField(max_length=20)
    description = models.TextField(null=True, blank=True)
    preview_file_id = models.UUIDField(null=True, blank=True)
    section_types = models.JSONField(
        default=dict,
        blank=True,
        help_text="Section catalogue keyed by type: {label, schema} per type.",
    )
    config_schema = models.JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "themes"
        ordering = ["code"]
        constraints = [
            models.UniqueConstraint(fields=["code"], name="themes_unique_code"),
        ]
        indexes = [models.Index(fields=["is_active"], name="themes_is_active_idx")]

    def __str__(self) -> str:
        return f"{self.code} {self.version}"


class WebsiteSettings(TenantOwnedModel):
    """One row per tenant: the site's global state and theme binding."""

    theme = models.ForeignKey(Theme, on_delete=models.PROTECT, related_name="+")
    theme_config = models.JSONField(default=dict, blank=True)
    homepage_page = models.ForeignKey(
        "website_cms.WebsitePage",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    is_published = models.BooleanField(default=False)
    maintenance_mode = models.BooleanField(default=False)
    header_config = models.JSONField(default=dict, blank=True)
    footer_config = models.JSONField(default=dict, blank=True)
    social_links = models.JSONField(default=list, blank=True)
    analytics_id = models.CharField(max_length=60, null=True, blank=True)
    default_locale = models.CharField(max_length=10, null=True, blank=True)

    class Meta:
        db_table = "website_settings"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant"],
                name="website_settings_unique_tenant",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]

    def __str__(self) -> str:
        return f"Website settings for {self.tenant_id}"


class WebsitePage(TenantOwnedModel):
    """A page on the public site, composed of ordered sections."""

    title = models.CharField(max_length=200)
    slug = models.CharField(max_length=PAGE_SLUG_MAX_LENGTH)
    page_type = models.CharField(max_length=30, choices=PageType.choices, default=PageType.STANDARD)
    status = models.CharField(
        max_length=20, choices=ContentStatus.choices, default=ContentStatus.DRAFT
    )
    published_at = models.DateTimeField(null=True, blank=True)
    locale = models.CharField(max_length=10, null=True, blank=True)
    show_in_search = models.BooleanField(default=True)

    class Meta:
        db_table = "website_pages"
        ordering = ["slug", "id"]
        constraints = [
            # `nulls_distinct=False`: a null locale (the default locale) must still collide.
            models.UniqueConstraint(
                fields=["tenant", "slug", "locale"],
                name="website_pages_unique_slug_locale",
                condition=models.Q(deleted_at__isnull=True),
                nulls_distinct=False,
            ),
            # Exactly one live home page per tenant.
            models.UniqueConstraint(
                fields=["tenant"],
                name="website_pages_one_home_per_tenant",
                condition=models.Q(page_type="home", deleted_at__isnull=True),
            ),
        ]
        indexes = [
            models.Index(
                fields=["tenant", "status", "page_type"], name="website_pages_status_type_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.slug} ({self.title})"


class PageSection(TenantOwnedModel):
    """An ordered, typed content block; `content` is validated against the theme's schema."""

    website_page = models.ForeignKey(WebsitePage, on_delete=models.CASCADE, related_name="sections")
    section_type = models.CharField(max_length=50)
    position = models.PositiveIntegerField()
    content = models.JSONField(default=dict, blank=True)
    is_visible = models.BooleanField(default=True)

    class Meta:
        db_table = "page_sections"
        ordering = ["website_page_id", "position", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["website_page", "position"],
                name="page_sections_unique_position",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]
        indexes = [models.Index(fields=["website_page"], name="page_sections_page_idx")]

    def __str__(self) -> str:
        return f"{self.section_type}@{self.position}"


class NavigationMenu(TenantOwnedModel):
    """The editable menu tree for one site location."""

    location = models.CharField(max_length=30, choices=MenuLocation.choices)
    items = models.JSONField(default=list, blank=True)

    class Meta:
        db_table = "navigation_menus"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "location"],
                name="navigation_menus_unique_location",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]

    def __str__(self) -> str:
        return f"{self.location} menu"


class SeoSetting(TenantOwnedModel):
    """Site-wide or per-content SEO metadata; polymorphic target validated in the service."""

    target_type = models.CharField(max_length=30, choices=SeoTargetType.choices)
    target_id = models.UUIDField(null=True, blank=True)
    meta_title = models.CharField(max_length=70, null=True, blank=True)
    meta_description = models.CharField(max_length=170, null=True, blank=True)
    og_image_file_id = models.UUIDField(null=True, blank=True)
    canonical_url = models.CharField(max_length=500, null=True, blank=True)
    robots = models.CharField(max_length=50, null=True, blank=True)
    structured_data = models.JSONField(null=True, blank=True)

    class Meta:
        db_table = "seo_settings"
        constraints = [
            # `nulls_distinct=False`: the single `site` row has a null target_id.
            models.UniqueConstraint(
                fields=["tenant", "target_type", "target_id"],
                name="seo_settings_unique_target",
                condition=models.Q(deleted_at__isnull=True),
                nulls_distinct=False,
            ),
        ]

    def __str__(self) -> str:
        return f"SEO {self.target_type} {self.target_id}"
