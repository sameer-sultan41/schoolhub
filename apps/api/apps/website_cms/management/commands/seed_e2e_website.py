"""Seed the public website's live-lane fixtures: a live site for each e2e tenant.

Run by `seed_e2e_data` (after it has seeded both tenants, their admins and the
`module.website` flag), never on its own against anything but a local or CI database. A command
of this app because it writes `website_cms` models, and `core` imports no app (ADR-0013).
Everything goes through the module's services, so the seeded site is one staff could have
built: sections pass the theme's schemas and publishing syncs file visibility.

The e2e tenant gets published home, about and contact pages, one draft page, one published
news post, event and album (with one real image, written to storage like any server-generated
file), and a published site. The other tenant gets a live site with only its home page (a
hero and a news list), so a cross-tenant probe of its host reaches the content lookup instead
of stopping at an unpublished site.

Idempotent: each row has a natural key (a slug), and a re-run never touches a row that is
already published.
"""

from __future__ import annotations

import base64
from datetime import timedelta
from typing import Any

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.website_cms.constants import HOMEPAGE_SLUG
from apps.website_cms.gallery.item_services import create_gallery_item
from apps.website_cms.gallery.services import create_gallery_album, publish_gallery_album
from apps.website_cms.models import (
    ContentStatus,
    GalleryAlbum,
    GalleryItem,
    MediaType,
    NewsPost,
    PageSection,
    SchoolEvent,
    WebsitePage,
)
from apps.website_cms.news_posts.services import create_news_post, publish_news_post
from apps.website_cms.pages.services import (
    create_page,
    publish_page,
    replace_sections,
    unpublish_page,
)
from apps.website_cms.revalidation import host_tags, queue_revalidation
from apps.website_cms.school_events.services import create_school_event, publish_school_event
from apps.website_cms.settings.services import ensure_default_site, update_settings
from apps.website_cms.uploads import WEBSITE_MEDIA
from core.files.services import create_ready_file
from core.rbac.management.commands.seed_e2e_data import (
    E2E_ADMIN_EMAIL,
    E2E_OTHER_ADMIN_EMAIL,
    E2E_OTHER_TENANT_SLUG,
    E2E_TENANT_SLUG,
)
from core.rbac.models import User
from core.tenancy.context import tenant_context
from core.tenancy.models import Tenant

# Mirrored in e2e/src/lib/seed-constants.ts.
E2E_WEBSITE_HOME_HEADING = "Welcome to E2E School"
E2E_WEBSITE_ABOUT_HEADING = "About E2E School"
E2E_WEBSITE_CONTACT_HEADING = "Write to E2E School"
E2E_WEBSITE_DRAFT_PAGE_SLUG = "e2e-draft-notes"
E2E_WEBSITE_DRAFT_PAGE_HEADING = "E2E draft notes"
E2E_WEBSITE_NEWS_SLUG = "e2e-website-launch"
E2E_WEBSITE_NEWS_TITLE = "E2E School launches its website"
E2E_WEBSITE_NEWS_BODY = "Families can now follow school news online."
E2E_WEBSITE_EVENT_SLUG = "e2e-open-day"
E2E_WEBSITE_EVENT_TITLE = "E2E Open Day"
E2E_WEBSITE_ALBUM_SLUG = "e2e-campus-tour"
E2E_WEBSITE_ALBUM_TITLE = "E2E Campus Tour"
E2E_WEBSITE_IMAGE_ALT = "E2E campus courtyard"
E2E_WEBSITE_OTHER_HOME_HEADING = "Welcome to E2E Other School"

#: Days ahead of the first seed the event starts, so it is listed as upcoming.
E2E_WEBSITE_EVENT_DAYS_AHEAD = 30
#: A valid 1x1 PNG: the album image the live lane loads through the public file redirect.
E2E_WEBSITE_IMAGE_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


def _section(section_type: str, content: dict[str, Any]) -> dict[str, Any]:
    return {"section_type": section_type, "content": content, "is_visible": True}


def _paragraph(text: str) -> dict[str, Any]:
    return {"blocks": [{"type": "paragraph", "text": text}]}


#: slug → sections, for the e2e tenant's published pages.
E2E_WEBSITE_PAGES: dict[str, list[dict[str, Any]]] = {
    HOMEPAGE_SLUG: [
        _section(
            "hero",
            {"heading": E2E_WEBSITE_HOME_HEADING, "subheading": "A school for curious minds."},
        ),
        _section("news_list", {"heading": "Latest news", "limit": 3}),
        _section("events_list", {"heading": "Upcoming events", "limit": 3}),
    ],
    "about": [
        _section(
            "about_school",
            {"heading": E2E_WEBSITE_ABOUT_HEADING, "body": "E2E School opened its doors in 2001."},
        ),
        _section(
            "faq",
            {
                "heading": "Questions",
                "items": [{"question": "When do classes start?", "answer": "At 8 o'clock."}],
            },
        ),
    ],
    "contact": [
        _section("contact_form", {"heading": E2E_WEBSITE_CONTACT_HEADING, "form": "contact"}),
    ],
}


class Command(BaseCommand):
    help = (
        "Seed the website live-lane fixtures: published pages, news, an event and an album, "
        "and a live site, for the e2e tenants. Run by seed_e2e_data."
    )

    @transaction.atomic
    def handle(self, *args, **options):
        tenant = Tenant.objects.get(slug=E2E_TENANT_SLUG)
        other_tenant = Tenant.objects.get(slug=E2E_OTHER_TENANT_SLUG)
        admin = User.objects.get(tenant=tenant, email=E2E_ADMIN_EMAIL)
        other_admin = User.objects.get(tenant=other_tenant, email=E2E_OTHER_ADMIN_EMAIL)

        with tenant_context(tenant.id):
            ensure_default_site(tenant, admin.pk)
            for slug, sections in E2E_WEBSITE_PAGES.items():
                self._publish_page(slug, sections, admin)
            self._ensure_draft_page(tenant, admin)
            self._ensure_news_post(tenant, admin)
            self._ensure_event(tenant, admin)
            self._ensure_album(tenant, admin)
            self._publish_site(tenant, admin)

        with tenant_context(other_tenant.id):
            ensure_default_site(other_tenant, other_admin.pk)
            # A news list too, so a probe can see it lists none of the e2e tenant's posts.
            self._publish_page(
                HOMEPAGE_SLUG,
                [
                    _section("hero", {"heading": E2E_WEBSITE_OTHER_HOME_HEADING}),
                    _section("news_list", {"heading": "Latest news", "limit": 3}),
                ],
                other_admin,
            )
            self._publish_site(other_tenant, other_admin)

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded live websites for '{tenant.slug}' (pages, news "
                f"'{E2E_WEBSITE_NEWS_SLUG}', event, album) and '{other_tenant.slug}' (home)"
            )
        )

    def _publish_page(self, slug: str, sections: list[dict[str, Any]], user: User) -> None:
        """Give a default page its fixture sections and publish it; a published page stays."""
        page = WebsitePage.objects.alive().get(slug=slug)
        if page.status == ContentStatus.PUBLISHED:
            return
        replace_sections(page, sections, user)
        publish_page(page, user)

    def _ensure_draft_page(self, tenant: Tenant, user: User) -> None:
        """A page with a visible section that stays a draft: the renderer must 404 it."""
        page = WebsitePage.objects.alive().filter(slug=E2E_WEBSITE_DRAFT_PAGE_SLUG).first()
        if page is None:
            page = create_page(
                tenant,
                {"title": E2E_WEBSITE_DRAFT_PAGE_HEADING, "slug": E2E_WEBSITE_DRAFT_PAGE_SLUG},
                user.pk,
            )
        elif page.status == ContentStatus.PUBLISHED:
            unpublish_page(page, user)
        if not PageSection.objects.alive().filter(website_page=page).exists():
            replace_sections(
                page,
                [_section("rich_text", {"body": _paragraph(E2E_WEBSITE_DRAFT_PAGE_HEADING)})],
                user,
            )

    def _ensure_news_post(self, tenant: Tenant, user: User) -> None:
        post = NewsPost.objects.alive().filter(slug=E2E_WEBSITE_NEWS_SLUG).first()
        if post is None:
            post = create_news_post(
                tenant,
                {
                    "title": E2E_WEBSITE_NEWS_TITLE,
                    "slug": E2E_WEBSITE_NEWS_SLUG,
                    "excerpt": E2E_WEBSITE_NEWS_BODY,
                    "body": _paragraph(E2E_WEBSITE_NEWS_BODY),
                },
                user.pk,
            )
        publish_news_post(post, user)

    def _ensure_event(self, tenant: Tenant, user: User) -> None:
        event = SchoolEvent.objects.alive().filter(slug=E2E_WEBSITE_EVENT_SLUG).first()
        if event is None:
            starts_at = timezone.now() + timedelta(days=E2E_WEBSITE_EVENT_DAYS_AHEAD)
            event = create_school_event(
                tenant,
                {
                    "title": E2E_WEBSITE_EVENT_TITLE,
                    "slug": E2E_WEBSITE_EVENT_SLUG,
                    "starts_at": starts_at,
                    "ends_at": starts_at + timedelta(hours=3),
                    "location": "Main hall",
                    "description": _paragraph("Meet the teachers and tour the school."),
                },
                user.pk,
            )
        publish_school_event(event, user)

    def _ensure_album(self, tenant: Tenant, user: User) -> None:
        """An album with one image, stored like any server-generated file (`create_ready_file`)."""
        album = GalleryAlbum.objects.alive().filter(slug=E2E_WEBSITE_ALBUM_SLUG).first()
        if album is None:
            album = create_gallery_album(
                tenant,
                {"title": E2E_WEBSITE_ALBUM_TITLE, "slug": E2E_WEBSITE_ALBUM_SLUG},
                user.pk,
            )
        if not GalleryItem.objects.alive().filter(gallery_album=album).exists():
            image = create_ready_file(
                tenant_id=tenant.id,
                purpose=WEBSITE_MEDIA.key,
                original_name="e2e-campus.png",
                mime_type="image/png",
                data=E2E_WEBSITE_IMAGE_PNG,
                actor_id=user.pk,
            )
            create_gallery_item(
                tenant,
                album,
                {
                    "media_type": MediaType.IMAGE,
                    "file_id": image.id,
                    "alt_text": E2E_WEBSITE_IMAGE_ALT,
                },
                user,
            )
        publish_gallery_album(album, user)

    def _publish_site(self, tenant: Tenant, user: User) -> None:
        """`is_published`, as the settings PATCH sets it, with the same revalidation."""
        row = ensure_default_site(tenant, user.pk)
        if row.is_published:
            return
        update_settings(row, {"is_published": True}, user.pk)
        queue_revalidation(tenant.id, host_tags(tenant))
