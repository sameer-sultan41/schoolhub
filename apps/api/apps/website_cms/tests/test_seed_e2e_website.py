"""Tests for `seed_e2e_website`: both e2e tenants' live sites for the website live specs.

Real Postgres via `TestCase`, for the reason core/rbac/tests/test_seed_e2e_data.py gives: the
command writes through `tenant_context`, so RLS has to be live.
"""

from __future__ import annotations

from django.core.management import call_command
from django.test import TestCase

from apps.website_cms.constants import HOMEPAGE_SLUG, WebsiteStatus
from apps.website_cms.hosts import website_status
from apps.website_cms.management.commands.seed_e2e_website import (
    E2E_WEBSITE_ALBUM_SLUG,
    E2E_WEBSITE_DRAFT_PAGE_SLUG,
    E2E_WEBSITE_EVENT_SLUG,
    E2E_WEBSITE_IMAGE_ALT,
    E2E_WEBSITE_NEWS_SLUG,
    E2E_WEBSITE_PAGES,
)
from apps.website_cms.models import (
    ContentStatus,
    GalleryAlbum,
    GalleryItem,
    NewsPost,
    PageSection,
    SchoolEvent,
    WebsitePage,
)
from apps.website_cms.tests.factories import TenantFactory, UserFactory, default_theme
from core.files.models import File, FileVisibility
from core.rbac.management.commands.seed_e2e_data import (
    E2E_ADMIN_EMAIL,
    E2E_OTHER_ADMIN_EMAIL,
    E2E_OTHER_TENANT_SLUG,
    E2E_TENANT_SLUG,
)
from core.tenancy.context import tenant_context


class SeedE2EWebsiteTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        default_theme()
        # The command looks both tenants and their admins up by what `seed_e2e_data` seeds.
        self.tenant = TenantFactory(slug=E2E_TENANT_SLUG)
        self.other_tenant = TenantFactory(slug=E2E_OTHER_TENANT_SLUG)
        UserFactory(tenant=self.tenant, email=E2E_ADMIN_EMAIL)
        UserFactory(tenant=self.other_tenant, email=E2E_OTHER_ADMIN_EMAIL)

    def seed(self) -> None:
        call_command("seed_e2e_website")

    def test_publishes_both_sites(self) -> None:
        self.seed()

        self.assertEqual(website_status(self.tenant), WebsiteStatus.LIVE)
        self.assertEqual(website_status(self.other_tenant), WebsiteStatus.LIVE)
        with tenant_context(self.other_tenant.id):
            home = WebsitePage.objects.alive().get(slug=HOMEPAGE_SLUG)
            self.assertEqual(home.status, ContentStatus.PUBLISHED)

    def test_publishes_the_pages_and_content_and_keeps_the_draft_a_draft(self) -> None:
        self.seed()

        with tenant_context(self.tenant.id):
            for slug, sections in E2E_WEBSITE_PAGES.items():
                page = WebsitePage.objects.alive().get(slug=slug)
                self.assertEqual(page.status, ContentStatus.PUBLISHED, slug)
                self.assertEqual(
                    list(
                        PageSection.objects.alive()
                        .filter(website_page=page)
                        .order_by("position")
                        .values_list("section_type", flat=True)
                    ),
                    [section["section_type"] for section in sections],
                )
            draft = WebsitePage.objects.alive().get(slug=E2E_WEBSITE_DRAFT_PAGE_SLUG)
            self.assertEqual(draft.status, ContentStatus.DRAFT)
            # Not empty: the renderer's 404 must come from the status, not a missing section.
            self.assertTrue(PageSection.objects.alive().filter(website_page=draft).exists())
            statuses = {
                NewsPost.objects.alive().get(slug=E2E_WEBSITE_NEWS_SLUG).status,
                SchoolEvent.objects.alive().get(slug=E2E_WEBSITE_EVENT_SLUG).status,
                GalleryAlbum.objects.alive().get(slug=E2E_WEBSITE_ALBUM_SLUG).status,
            }
            self.assertEqual(statuses, {ContentStatus.PUBLISHED})

    def test_the_album_image_is_a_ready_public_file(self) -> None:
        self.seed()

        with tenant_context(self.tenant.id):
            item = GalleryItem.objects.alive().get(gallery_album__slug=E2E_WEBSITE_ALBUM_SLUG)
            self.assertEqual(item.alt_text, E2E_WEBSITE_IMAGE_ALT)
            image = File.objects.get(pk=item.file_id)
        # Publishing the album made the file public, so the public redirect serves it.
        self.assertEqual(image.visibility, FileVisibility.PUBLIC)

    def test_is_idempotent(self) -> None:
        def snapshot() -> tuple[list, ...]:
            with tenant_context(self.tenant.id):
                return (
                    sorted(WebsitePage.objects.alive().values_list("pk", "status")),
                    sorted(PageSection.objects.alive().values_list("pk", flat=True)),
                    sorted(NewsPost.objects.alive().values_list("pk", flat=True)),
                    sorted(SchoolEvent.objects.alive().values_list("pk", flat=True)),
                    sorted(GalleryItem.objects.alive().values_list("pk", flat=True)),
                    sorted(File.objects.values_list("pk", flat=True)),
                )

        self.seed()
        before = snapshot()
        self.seed()

        self.assertEqual(snapshot(), before)
        self.assertEqual(len(before[4]), 1)
