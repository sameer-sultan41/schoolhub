"""Cross-tenant isolation for the website module's tables.

A1 ships no endpoints, so the 404-never-403 endpoint tests arrive with each resource (A3/A4).
What can be asserted now is the database boundary under them: a row of tenant B is invisible,
and unwritable, in tenant A's context (invariant 1, enforced by the RLS policies in 0002).
"""

from __future__ import annotations

from django.db import IntegrityError, ProgrammingError, connection, transaction
from django.test import TestCase

from apps.website_cms.models import (
    NavigationMenu,
    PageSection,
    SeoSetting,
    WebsitePage,
    WebsiteSettings,
)
from apps.website_cms.tests.base import WebsiteAPITestCase
from apps.website_cms.tests.factories import (
    NavigationMenuFactory,
    PageSectionFactory,
    SeoSettingFactory,
    TenantFactory,
    WebsitePageFactory,
    WebsiteSettingsFactory,
)
from core.tenancy.context import tenant_context


class WebsiteRlsIsolationTests(TestCase):
    def setUp(self) -> None:
        self.tenant_a = TenantFactory()
        self.tenant_b = TenantFactory()
        with tenant_context(self.tenant_b.id):
            self.settings_b = WebsiteSettingsFactory(tenant=self.tenant_b)
            self.page_b = WebsitePageFactory(tenant=self.tenant_b)
            self.section_b = PageSectionFactory(tenant=self.tenant_b, website_page=self.page_b)
            self.menu_b = NavigationMenuFactory(tenant=self.tenant_b)
            self.seo_b = SeoSettingFactory(tenant=self.tenant_b)

    def test_tenant_a_sees_none_of_tenant_bs_rows(self) -> None:
        with tenant_context(self.tenant_a.id):
            for model in (WebsiteSettings, WebsitePage, PageSection, NavigationMenu, SeoSetting):
                self.assertEqual(model.all_tenants.count(), 0, model.__name__)

    def test_tenant_b_sees_its_own_rows(self) -> None:
        with tenant_context(self.tenant_b.id):
            self.assertEqual(WebsitePage.objects.count(), 1)
            self.assertEqual(PageSection.objects.count(), 1)

    def test_tenant_a_cannot_insert_a_row_for_tenant_b(self) -> None:
        with (
            tenant_context(self.tenant_a.id),
            self.assertRaises((IntegrityError, ProgrammingError)),
            transaction.atomic(),
        ):
            WebsitePageFactory(tenant=self.tenant_b)

    def test_every_tenant_table_has_a_policy(self) -> None:
        tables = [
            "website_settings",
            "website_pages",
            "page_sections",
            "navigation_menus",
            "seo_settings",
        ]
        with connection.cursor() as cursor:
            cursor.execute("SELECT tablename FROM pg_policies WHERE tablename = ANY(%s)", [tables])
            covered = {row[0] for row in cursor.fetchall()}
        self.assertEqual(covered, set(tables))


class WebsiteCmsEndpointCrossTenantTests(WebsiteAPITestCase):
    """Tenant A, holding every website key, reaches nothing of tenant B's: 404, never 403."""

    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()
        self.other = TenantFactory()
        self.page_b = self.make_page(tenant=self.other, slug="theirs")
        self.section_b = self.make_section(self.page_b, position=0)
        self.make_settings(tenant=self.other, is_published=True)

    def _url(self, suffix: str = "") -> str:
        return f"/api/v1/website-pages/{self.page_b.id}{suffix}"

    def test_list_does_not_leak_the_other_tenants_pages(self) -> None:
        response = self.client.get("/api/v1/website-pages")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"], [])

    def test_detail_patch_delete_are_404(self) -> None:
        self.assertEqual(self.client.get(self._url()).status_code, 404)
        patched = self.client.patch(self._url(), {"title": "x"}, format="json")
        self.assertEqual(patched.status_code, 404)
        self.assertEqual(self.client.delete(self._url()).status_code, 404)

    def test_colon_actions_are_404(self) -> None:
        for action in ("publish", "unpublish", "archive", "preview"):
            with self.subTest(action=action):
                self.assertEqual(self.client.post(self._url(f":{action}")).status_code, 404)

    def test_replace_sections_is_404(self) -> None:
        response = self.client.patch(self._url("/page-sections"), {"sections": []}, format="json")
        self.assertEqual(response.status_code, 404)
        with tenant_context(self.other.id):
            self.assertEqual(PageSection.objects.alive().count(), 1)

    def test_a_foreign_page_is_not_a_homepage_candidate(self) -> None:
        with tenant_context(self.other.id):
            WebsitePage.objects.filter(id=self.page_b.id).update(page_type="home")
        response = self.client.patch(
            "/api/v1/website-settings", {"homepage_page_id": str(self.page_b.id)}, format="json"
        )
        self.assertEqual(response.status_code, 422)

    def test_settings_show_this_tenants_state_only(self) -> None:
        data = self.client.get("/api/v1/website-settings").json()["data"]
        self.assertFalse(data["exists"])
        self.assertFalse(data["is_published"])

    def test_a_foreign_file_cannot_be_referenced_from_a_section(self) -> None:
        from apps.website_cms.uploads import WEBSITE_MEDIA
        from core.files.tests.factories import FileFactory

        with tenant_context(self.other.id):
            theirs = FileFactory(tenant=self.other, purpose=WEBSITE_MEDIA.key)
        mine = self.make_page(slug="mine")
        response = self.client.patch(
            f"/api/v1/website-pages/{mine.id}/page-sections",
            {
                "sections": [
                    {
                        "section_type": "hero",
                        "content": {"heading": "H", "image_file_id": str(theirs.id)},
                        "is_visible": True,
                    }
                ]
            },
            format="json",
        )
        self.assertEqual(response.status_code, 422)


class NavigationSeoCrossTenantTests(WebsiteAPITestCase):
    """Menus and SEO rows of tenant B are invisible to tenant A, and not referable."""

    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()
        self.other = TenantFactory()
        self.page_b = self.make_page(tenant=self.other, slug="theirs", status="published")
        with tenant_context(self.other.id):
            NavigationMenuFactory(
                tenant=self.other,
                items=[{"label": "Theirs", "target_type": "news_index", "children": []}],
            )
            SeoSettingFactory(tenant=self.other, meta_title="Theirs")

    def test_menus_show_this_tenants_state_only(self) -> None:
        data = self.client.get("/api/v1/navigation-menus").json()["data"]
        self.assertTrue(all(menu["items"] == [] for menu in data))

    def test_a_foreign_page_is_not_a_menu_target(self) -> None:
        item = {"label": "X", "target_type": "page", "target": str(self.page_b.id)}
        response = self.client.patch(
            "/api/v1/navigation-menus/header", {"items": [item]}, format="json"
        )
        self.assertEqual(response.status_code, 422)
        with tenant_context(self.other.id):
            self.assertEqual(NavigationMenu.objects.get().items[0]["label"], "Theirs")

    def test_seo_shows_this_tenants_state_only(self) -> None:
        data = self.client.get("/api/v1/seo-settings", {"target_type": "site"}).json()["data"]
        self.assertFalse(data["exists"])
        self.assertIsNone(data["meta_title"])

    def test_seo_write_creates_a_row_for_this_tenant_only(self) -> None:
        url = "/api/v1/seo-settings?target_type=site"
        response = self.client.patch(url, {"meta_title": "Mine"}, format="json")
        self.assertEqual(response.status_code, 200)
        with tenant_context(self.other.id):
            self.assertEqual(SeoSetting.objects.get().meta_title, "Theirs")
