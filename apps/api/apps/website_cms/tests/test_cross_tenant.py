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
