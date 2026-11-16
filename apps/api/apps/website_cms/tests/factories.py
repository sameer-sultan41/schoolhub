"""Factories for the website module tests.

See school_organization/tests/factories.py's module docstring for why every factory writes
through the tenant-scoped default manager inside ``tenant_context(...)``.
"""

from __future__ import annotations

import factory
from django.utils import timezone

from apps.school_organization.tests.factories import (
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.website_cms.models import (
    ContactStatus,
    ContactSubmission,
    ContentStatus,
    CustomDomain,
    CustomDomainRoute,
    CustomDomainStatus,
    GalleryAlbum,
    GalleryItem,
    MediaType,
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
from core.tenancy.models import FeatureFlag, TenantFeatureOverride


def default_theme() -> Theme:
    """The synced `default` theme; `post_migrate` creates it, this is the safety net."""
    from apps.website_cms.themes import sync_themes

    theme = Theme.objects.filter(code="default").first()
    if theme is None:
        sync_themes()
        theme = Theme.objects.get(code="default")
    return theme


class WebsiteSettingsFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = WebsiteSettings

    tenant = factory.SubFactory(TenantFactory)
    theme = factory.LazyFunction(default_theme)


class WebsitePageFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = WebsitePage

    tenant = factory.SubFactory(TenantFactory)
    title = factory.Sequence(lambda n: f"Page {n}")
    slug = factory.Sequence(lambda n: f"page-{n}")
    page_type = PageType.STANDARD
    status = ContentStatus.DRAFT


class PageSectionFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = PageSection

    tenant = factory.SubFactory(TenantFactory)
    website_page = factory.SubFactory(WebsitePageFactory)
    section_type = "hero"
    position = factory.Sequence(lambda n: n)
    content = factory.LazyFunction(lambda: {"heading": "Welcome"})


class NavigationMenuFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = NavigationMenu

    tenant = factory.SubFactory(TenantFactory)
    location = MenuLocation.HEADER
    items = factory.LazyFunction(list)


class SeoSettingFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = SeoSetting

    tenant = factory.SubFactory(TenantFactory)
    target_type = SeoTargetType.SITE
    meta_title = "A school"


class NewsPostFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = NewsPost

    tenant = factory.SubFactory(TenantFactory)
    title = factory.Sequence(lambda n: f"News {n}")
    slug = factory.Sequence(lambda n: f"news-{n}")
    body = factory.LazyFunction(lambda: {"blocks": [{"type": "paragraph", "text": "Hello"}]})
    status = ContentStatus.DRAFT


class ContactSubmissionFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = ContactSubmission

    tenant = factory.SubFactory(TenantFactory)
    name = factory.Sequence(lambda n: f"Visitor {n}")
    email = factory.Sequence(lambda n: f"visitor{n}@example.com")
    message = "Do you have places in Grade 3?"
    status = ContactStatus.NEW
    ip = "203.0.113.7"


class SchoolEventFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = SchoolEvent

    tenant = factory.SubFactory(TenantFactory)
    title = factory.Sequence(lambda n: f"Event {n}")
    slug = factory.Sequence(lambda n: f"event-{n}")
    description = factory.LazyFunction(lambda: {"blocks": [{"type": "paragraph", "text": "Join"}]})
    starts_at = factory.LazyFunction(timezone.now)
    status = ContentStatus.DRAFT


class GalleryAlbumFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = GalleryAlbum

    tenant = factory.SubFactory(TenantFactory)
    title = factory.Sequence(lambda n: f"Album {n}")
    slug = factory.Sequence(lambda n: f"album-{n}")
    status = ContentStatus.DRAFT


class GalleryItemFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = GalleryItem

    tenant = factory.SubFactory(TenantFactory)
    gallery_album = factory.SubFactory(GalleryAlbumFactory)
    media_type = MediaType.VIDEO_EMBED
    embed_url = "https://www.youtube.com/watch?v=abc"
    position = factory.Sequence(lambda n: n)


class CustomDomainFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = CustomDomain

    tenant = factory.SubFactory(TenantFactory)
    domain = factory.Sequence(lambda n: f"school{n}.example.org")
    verification_token = factory.Sequence(lambda n: f"token-{n}")


def make_custom_domain(tenant, domain: str, status: str, *, is_primary: bool = False):
    """A custom domain of ``tenant``; an active one also gets its route row, as services do."""
    from core.tenancy.context import tenant_context

    with tenant_context(tenant.id):
        row = CustomDomainFactory(
            tenant=tenant, domain=domain, status=status, is_primary=is_primary
        )
    if status == CustomDomainStatus.ACTIVE:
        CustomDomainRoute.objects.create(domain=domain, tenant=tenant, custom_domain=row)
    return row


def enable_feature(tenant, key: str) -> None:
    """Force ``key`` on for ``tenant``; `module.website` ships `default_enabled=False`."""
    from core.tenancy.context import tenant_context

    flag = FeatureFlag.objects.get(key=key)
    with tenant_context(tenant.id):
        TenantFeatureOverride.objects.update_or_create(
            tenant=tenant,
            feature_flag=flag,
            defaults={"enabled": True, "reason": "website_cms test fixture"},
        )


__all__ = [
    "ContactSubmissionFactory",
    "CustomDomainFactory",
    "GalleryAlbumFactory",
    "GalleryItemFactory",
    "NavigationMenuFactory",
    "NewsPostFactory",
    "SchoolEventFactory",
    "PageSectionFactory",
    "SeoSettingFactory",
    "TenantFactory",
    "UserFactory",
    "WebsitePageFactory",
    "WebsiteSettingsFactory",
    "authenticate",
    "default_theme",
    "enable_feature",
    "grant",
    "make_custom_domain",
]
