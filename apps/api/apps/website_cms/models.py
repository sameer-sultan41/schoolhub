"""Models for the website module.

Behaviour: docs/03-modules/website-cms.md. Column-level specs:
docs/05-database/entities/website-cms.md.

Uniqueness is enforced by partial unique indexes on live rows (`deleted_at IS NULL`), so a
soft-deleted slug or menu can be reused (decision 14). String columns use "" for "unset"
(never NULL), so a nullable text column does not exist and DJ001 holds without suppression.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models.functions import Lower

from apps.website_cms.constants import (
    CONTACT_EMAIL_MAX,
    CONTACT_NAME_MAX,
    CONTACT_PHONE_MAX,
    CONTACT_SUBJECT_MAX,
    CONTENT_SLUG_MAX_LENGTH,
    DOMAIN_ERROR_MAX_LENGTH,
    DOMAIN_MAX_LENGTH,
    DOMAIN_TOKEN_MAX_LENGTH,
    EMBED_URL_MAX_LENGTH,
    PAGE_SLUG_MAX_LENGTH,
    empty_rich_text,
)
from core.tenancy.models import Tenant, TenantOwnedModel, TimestampedModel


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


class MediaType(models.TextChoices):
    IMAGE = "image", "Image"
    VIDEO_EMBED = "video_embed", "Video embed"


class ContactStatus(models.TextChoices):
    NEW = "new", "New"
    READ = "read", "Read"
    RESPONDED = "responded", "Responded"
    SPAM = "spam", "Spam"


class CustomDomainStatus(models.TextChoices):
    PENDING_DNS = "pending_dns", "Pending DNS"
    VERIFYING = "verifying", "Verifying"
    ACTIVE = "active", "Active"
    FAILED = "failed", "Failed"
    DISABLED = "disabled", "Disabled"


class DomainErrorCode(models.TextChoices):
    """Why a custom domain's last check failed, for clients to act on; `last_error` is prose."""

    TXT_MISSING = "txt_missing", "TXT record missing"
    TXT_MISMATCH = "txt_mismatch", "TXT record holds another token"
    CNAME_MISSING = "cname_missing", "CNAME record missing"
    CNAME_MISMATCH = "cname_mismatch", "CNAME points elsewhere"
    LOOKUP_TIMEOUT = "lookup_timeout", "DNS lookup timed out"
    LOOKUP_FAILED = "lookup_failed", "DNS lookup failed"
    DOMAIN_TAKEN = "domain_taken", "Another school uses the domain"
    TARGET_UNCONFIGURED = "target_unconfigured", "Platform CNAME target not configured"


class TlsStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    ISSUED = "issued", "Issued"
    FAILED = "failed", "Failed"


class Theme(TimestampedModel):
    """A website theme. Platform scope: no tenant_id, no RLS; tenants reference, never edit.

    Rows are synced from code (`themes/`) on `post_migrate`, never hand-edited.
    """

    name = models.CharField(max_length=100)
    code = models.CharField(max_length=50)
    version = models.CharField(max_length=20)
    description = models.TextField(blank=True, default="")
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
    analytics_id = models.CharField(max_length=60, blank=True, default="")
    default_locale = models.CharField(max_length=10, blank=True, default="")

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
    locale = models.CharField(max_length=10, blank=True, default="")
    show_in_search = models.BooleanField(default=True)

    class Meta:
        db_table = "website_pages"
        ordering = ["slug", "id"]
        constraints = [
            # `locale` is "" for the default locale, so a plain unique collides as needed.
            models.UniqueConstraint(
                fields=["tenant", "slug", "locale"],
                name="website_pages_unique_slug_locale",
                condition=models.Q(deleted_at__isnull=True),
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
    meta_title = models.CharField(max_length=70, blank=True, default="")
    meta_description = models.CharField(max_length=170, blank=True, default="")
    og_image_file_id = models.UUIDField(null=True, blank=True)
    canonical_url = models.CharField(max_length=500, blank=True, default="")
    robots = models.CharField(max_length=50, blank=True, default="")
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


class NewsPost(TenantOwnedModel):
    """A school news article; `body` is a rich-text block document."""

    title = models.CharField(max_length=200)
    slug = models.CharField(max_length=CONTENT_SLUG_MAX_LENGTH)
    excerpt = models.CharField(max_length=500, blank=True, default="")
    body = models.JSONField(default=empty_rich_text, blank=True)
    cover_image_file_id = models.UUIDField(null=True, blank=True)
    status = models.CharField(
        max_length=20, choices=ContentStatus.choices, default=ContentStatus.DRAFT
    )
    published_at = models.DateTimeField(null=True, blank=True)
    locale = models.CharField(max_length=10, blank=True, default="")

    class Meta:
        db_table = "news_posts"
        ordering = ["-published_at", "-created_at", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "slug"],
                name="news_posts_unique_slug",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]
        indexes = [
            models.Index(
                fields=["tenant", "status", "published_at"], name="news_posts_status_pub_idx"
            ),
        ]

    def __str__(self) -> str:
        return self.slug


class SchoolEvent(TenantOwnedModel):
    """A public website event (open day, annual function); `description` is rich text."""

    title = models.CharField(max_length=200)
    slug = models.CharField(max_length=CONTENT_SLUG_MAX_LENGTH)
    description = models.JSONField(default=empty_rich_text, blank=True)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField(null=True, blank=True)
    is_all_day = models.BooleanField(default=False)
    location = models.CharField(max_length=200, blank=True, default="")
    cover_image_file_id = models.UUIDField(null=True, blank=True)
    status = models.CharField(
        max_length=20, choices=ContentStatus.choices, default=ContentStatus.DRAFT
    )

    class Meta:
        db_table = "school_events"
        ordering = ["-starts_at", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "slug"],
                name="school_events_unique_slug",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]
        indexes = [
            models.Index(
                fields=["tenant", "status", "starts_at"], name="school_events_status_start_idx"
            ),
        ]

    def __str__(self) -> str:
        return self.slug


class GalleryAlbum(TenantOwnedModel):
    """An album of images and video embeds, optionally the album of a school event."""

    title = models.CharField(max_length=200)
    slug = models.CharField(max_length=CONTENT_SLUG_MAX_LENGTH)
    description = models.TextField(blank=True, default="")
    cover_image_file_id = models.UUIDField(null=True, blank=True)
    school_event = models.ForeignKey(
        SchoolEvent, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    status = models.CharField(
        max_length=20, choices=ContentStatus.choices, default=ContentStatus.DRAFT
    )
    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "gallery_albums"
        ordering = ["-created_at", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "slug"],
                name="gallery_albums_unique_slug",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "status"], name="gallery_albums_status_idx"),
        ]

    def __str__(self) -> str:
        return self.slug


class GalleryItem(TenantOwnedModel):
    """One media entry of an album, ordered by `position`."""

    gallery_album = models.ForeignKey(GalleryAlbum, on_delete=models.CASCADE, related_name="items")
    media_type = models.CharField(max_length=20, choices=MediaType.choices, default=MediaType.IMAGE)
    file_id = models.UUIDField(null=True, blank=True)
    embed_url = models.CharField(max_length=EMBED_URL_MAX_LENGTH, blank=True, default="")
    caption = models.CharField(max_length=300, blank=True, default="")
    alt_text = models.CharField(max_length=300, blank=True, default="")
    position = models.PositiveIntegerField()

    class Meta:
        db_table = "gallery_items"
        ordering = ["gallery_album_id", "position", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["gallery_album", "position"],
                name="gallery_items_unique_position",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]
        indexes = [models.Index(fields=["gallery_album"], name="gallery_items_album_idx")]

    def __str__(self) -> str:
        return f"{self.media_type}@{self.position}"


class ContactSubmission(TenantOwnedModel):
    """A public contact-form message. `created_by` stays NULL (anonymous submitter) and `ip`
    is never serialised to staff (privacy; retention-limited)."""

    name = models.CharField(max_length=CONTACT_NAME_MAX)
    email = models.CharField(max_length=CONTACT_EMAIL_MAX, blank=True, default="")
    phone = models.CharField(max_length=CONTACT_PHONE_MAX, blank=True, default="")
    subject = models.CharField(max_length=CONTACT_SUBJECT_MAX, blank=True, default="")
    message = models.TextField()
    source_page = models.ForeignKey(
        WebsitePage, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    status = models.CharField(
        max_length=20, choices=ContactStatus.choices, default=ContactStatus.NEW
    )
    handled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    ip = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        db_table = "contact_submissions"
        ordering = ["-created_at", "id"]
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(email="") | ~models.Q(phone=""),
                name="contact_submissions_email_or_phone",
            ),
        ]
        indexes = [
            models.Index(
                fields=["tenant", "status", "created_at"], name="contact_sub_status_created_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.status})"


class CustomDomain(TenantOwnedModel):
    """A school's claim on a custom domain for its site (plan decision 7).

    Unique per tenant, not globally: a claim proves nothing until DNS does, so two schools may
    both claim a domain and only verification activates one (`CustomDomainRoute`).
    """

    domain = models.CharField(max_length=DOMAIN_MAX_LENGTH)
    status = models.CharField(
        max_length=20, choices=CustomDomainStatus.choices, default=CustomDomainStatus.PENDING_DNS
    )
    verification_token = models.CharField(max_length=DOMAIN_TOKEN_MAX_LENGTH)
    verified_at = models.DateTimeField(null=True, blank=True)
    tls_status = models.CharField(
        max_length=20, choices=TlsStatus.choices, default=TlsStatus.PENDING
    )
    is_primary = models.BooleanField(default=False)
    last_error = models.CharField(max_length=DOMAIN_ERROR_MAX_LENGTH, blank=True, default="")
    last_error_code = models.CharField(
        max_length=30, choices=DomainErrorCode.choices, blank=True, default=""
    )
    failure_notified_at = models.DateTimeField(null=True, blank=True)
    consecutive_failures = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "custom_domains"
        ordering = ["domain", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "domain"],
                name="custom_domains_unique_tenant_domain",
                condition=models.Q(deleted_at__isnull=True),
            ),
            # Also serves the spec's (tenant_id, is_primary) lookup.
            models.UniqueConstraint(
                fields=["tenant"],
                name="custom_domains_one_primary_per_tenant",
                condition=models.Q(is_primary=True, deleted_at__isnull=True),
            ),
            models.CheckConstraint(
                condition=(models.Q(is_primary=False) | models.Q(status=CustomDomainStatus.ACTIVE)),
                name="custom_domains_primary_is_active",
            ),
            models.CheckConstraint(
                condition=models.Q(domain=Lower("domain")),
                name="custom_domains_domain_lowercase",
            ),
            # The target of `custom_domain_routes`' composite foreign key (migration 0007).
            models.UniqueConstraint(
                fields=["id", "tenant"], name="custom_domains_unique_id_tenant"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.domain} ({self.status})"


class CustomDomainRoute(TimestampedModel):
    """Active custom domain -> tenant, read by host resolution before any tenant is known.

    Platform scope: no RLS and not a `TenantOwnedModel`, because the lookup has no tenant to
    bind. It holds only active domains; services insert a row on activation and delete it on
    disable, failure or delete, in the same transaction. Rows are hard-deleted, never
    soft-deleted. Every write filters by both `custom_domain_id` and `tenant_id`, and a composite
    foreign key `(custom_domain_id, tenant_id) -> custom_domains (id, tenant_id)` (migration 0007)
    makes the database refuse a route whose tenant is not its domain's tenant.
    """

    domain = models.CharField(max_length=DOMAIN_MAX_LENGTH, unique=True)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="+")
    custom_domain = models.OneToOneField(CustomDomain, on_delete=models.CASCADE, related_name="+")

    objects = models.Manager()

    class Meta:
        db_table = "custom_domain_routes"
        ordering = ["domain"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(domain=Lower("domain")),
                name="custom_domain_routes_domain_lowercase",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.domain} -> {self.tenant_id}"
