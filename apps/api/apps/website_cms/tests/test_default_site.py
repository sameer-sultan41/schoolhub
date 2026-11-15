"""`ensure_default_site` (plan decision 10): content, idempotency and the concurrent race."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from django.db import connection
from django.test import TestCase, TransactionTestCase
from django.test.utils import CaptureQueriesContext

from apps.website_cms.defaults import DEFAULT_PAGES
from apps.website_cms.models import (
    ContentStatus,
    PageSection,
    PageType,
    WebsitePage,
    WebsiteSettings,
)
from apps.website_cms.settings.services import ensure_default_site
from apps.website_cms.tests.factories import TenantFactory, WebsitePageFactory, default_theme
from apps.website_cms.validation import validate_section_content
from core.tenancy.context import tenant_atomic, tenant_context


class DefaultContentTests(TestCase):
    def test_every_placeholder_section_is_valid_for_theme_v1(self) -> None:
        theme = default_theme()
        for _, slug, _, sections in DEFAULT_PAGES:
            for section_type, content in sections:
                with self.subTest(page=slug, section=section_type):
                    validate_section_content(theme, section_type, content)

    def test_covers_every_page_type_except_standard(self) -> None:
        self.assertEqual(
            {page_type for page_type, *_ in DEFAULT_PAGES},
            set(PageType.values) - {PageType.STANDARD},
        )


class EnsureDefaultSiteTests(TestCase):
    def setUp(self) -> None:
        self.tenant = TenantFactory()

    def test_creates_unpublished_site_with_draft_pages_and_homepage(self) -> None:
        with tenant_context(self.tenant.id):
            row = ensure_default_site(self.tenant)
            pages = list(WebsitePage.objects.alive())
            sections = PageSection.objects.alive().count()
        self.assertFalse(row.is_published)
        self.assertEqual(row.theme.code, "default")
        self.assertEqual(len(pages), 8)
        self.assertTrue(all(page.status == ContentStatus.DRAFT for page in pages))
        self.assertEqual(row.homepage_page.page_type, PageType.HOME)
        self.assertEqual(sections, sum(len(sections) for *_, sections in DEFAULT_PAGES))

    def test_seeding_uses_a_constant_number_of_queries(self) -> None:
        with tenant_context(self.tenant.id), CaptureQueriesContext(connection) as queries:
            ensure_default_site(self.tenant)
        # One bulk insert for pages and one for sections, whatever the page count.
        self.assertLessEqual(len(queries), 12)

    def test_second_call_changes_nothing(self) -> None:
        with tenant_context(self.tenant.id):
            first = ensure_default_site(self.tenant)
            second = ensure_default_site(self.tenant)
            self.assertEqual(first.id, second.id)
            self.assertEqual(WebsitePage.objects.alive().count(), 8)

    def test_existing_custom_page_with_a_standard_slug_is_kept(self) -> None:
        with tenant_context(self.tenant.id):
            WebsitePageFactory(tenant=self.tenant, slug="about", title="Mine")
            ensure_default_site(self.tenant)
            self.assertEqual(WebsitePage.objects.alive().filter(slug="about").count(), 1)
            self.assertEqual(WebsitePage.objects.alive().get(slug="about").title, "Mine")


class EnsureDefaultSiteConcurrencyTests(TransactionTestCase):
    def test_ensure_default_site_is_idempotent_under_concurrent_calls(self) -> None:
        tenant = TenantFactory()
        barrier = Barrier(2)

        def call() -> str:
            try:
                barrier.wait(timeout=10)
                with tenant_atomic(tenant.id):
                    return str(ensure_default_site(tenant).id)
            finally:
                connection.close()

        with ThreadPoolExecutor(max_workers=2) as pool:
            ids = [future.result() for future in [pool.submit(call), pool.submit(call)]]

        self.assertEqual(len(set(ids)), 1)
        with tenant_atomic(tenant.id):
            self.assertEqual(WebsiteSettings.objects.alive().count(), 1)
            self.assertEqual(WebsitePage.objects.alive().count(), 8)
