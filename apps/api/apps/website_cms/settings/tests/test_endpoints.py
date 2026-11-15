"""Endpoint tests for `/website-settings` and `/themes`."""

from __future__ import annotations

from unittest import mock

from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.website_cms.models import Theme, WebsitePage, WebsiteSettings
from apps.website_cms.tests.base import WebsiteAPITestCase
from core.tenancy.context import tenant_context

URL = "/api/v1/website-settings"


class WebsiteSettingsReadTests(WebsiteAPITestCase):
    def test_read_requires_the_page_view_key(self) -> None:
        self.assertEqual(self.client.get(URL).status_code, 403)

    def test_get_settings_without_row_returns_unsaved_default_and_writes_nothing(self) -> None:
        self.allow("website.page.view")
        response = self.client.get(URL)
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertFalse(data["exists"])
        self.assertEqual(data["theme_code"], "default")
        self.assertFalse(data["is_published"])
        with tenant_context(self.tenant.id):
            self.assertEqual(WebsiteSettings.objects.count(), 0)
            self.assertEqual(WebsitePage.objects.count(), 0)

    def test_get_settings_with_row_reports_exists(self) -> None:
        self.allow("website.page.view")
        self.make_settings(is_published=True)
        data = self.client.get(URL).json()["data"]
        self.assertTrue(data["exists"])
        self.assertTrue(data["is_published"])

    def test_bearer_token_alone_is_enough(self) -> None:
        self.allow("website.page.view")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(self.user)}")
        self.assertEqual(client.get(URL).status_code, 200)


class WebsiteSettingsUpdateTests(WebsiteAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow("website.page.view")

    def _patch(self, payload: dict):
        return self.client.patch(URL, payload, format="json")

    def test_patch_requires_the_settings_update_key(self) -> None:
        self.assertEqual(self._patch({"is_published": True}).status_code, 403)

    def test_first_patch_creates_the_default_site(self) -> None:
        self.allow("website.settings.update")
        response = self._patch({"analytics_id": "G-1"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["data"]["exists"])
        with tenant_context(self.tenant.id):
            self.assertEqual(WebsitePage.objects.alive().count(), 8)
            row = WebsiteSettings.objects.get()
            self.assertEqual(row.homepage_page.page_type, "home")
            self.assertEqual(row.analytics_id, "G-1")

    @override_settings(PLATFORM_DOMAIN="schools.test")
    def test_publishing_the_site_queues_revalidation_with_the_host_tag(self) -> None:
        self.allow("website.settings.update")
        with (
            mock.patch("apps.website_cms.revalidation.revalidate_website") as task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            self._patch({"is_published": True})
        task.delay.assert_called_once_with(
            str(self.tenant.id), [f"tenant-host:{self.tenant.slug}.schools.test"]
        )

    def test_unchanged_patch_queues_nothing(self) -> None:
        self.allow("website.settings.update")
        self._patch({"is_published": False})
        with (
            mock.patch("apps.website_cms.revalidation.revalidate_website") as task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            self._patch({"is_published": False})
        task.delay.assert_not_called()

    def test_homepage_must_be_the_home_page(self) -> None:
        self.allow("website.settings.update")
        other = self.make_page(slug="not-home")
        response = self._patch({"homepage_page_id": str(other.id)})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "domain_rule_violation")

    def test_homepage_cannot_be_cleared(self) -> None:
        self.allow("website.settings.update")
        self._patch({"analytics_id": "G-1"})
        response = self._patch({"homepage_page_id": None})
        self.assertEqual(response.status_code, 422)
        self.assertIn("homepage_page_id", str(response.json()))
        with tenant_context(self.tenant.id):
            self.assertIsNotNone(WebsiteSettings.objects.get().homepage_page_id)

    def test_patch_locks_the_row_and_writes_only_changed_columns(self) -> None:
        self.allow("website.settings.update")
        self._patch({"analytics_id": "G-1"})
        with CaptureQueriesContext(connection) as queries:
            self.assertEqual(self._patch({"is_published": True}).status_code, 200)
        sql = [q["sql"] for q in queries.captured_queries]
        lock = next(i for i, q in enumerate(sql) if "FOR UPDATE" in q and "website_settings" in q)
        update = next(i for i, q in enumerate(sql) if q.startswith('UPDATE "website_settings"'))
        self.assertLess(lock, update)
        self.assertIn('"is_published"', sql[update])
        self.assertNotIn('"header_config"', sql[update])

    def test_unknown_theme_is_rejected(self) -> None:
        self.allow("website.settings.update")
        response = self._patch({"theme_id": "00000000-0000-0000-0000-000000000000"})
        self.assertEqual(response.status_code, 422)

    def test_inactive_theme_is_rejected(self) -> None:
        self.allow("website.settings.update")
        theme = Theme.objects.get(code="default")
        alt = Theme.objects.create(
            code="retired",
            name="Retired",
            version="1.0.0",
            is_active=False,
            section_types=theme.section_types,
        )
        self.assertEqual(self._patch({"theme_id": str(alt.id)}).status_code, 422)

    def test_theme_config_is_validated_against_the_theme_schema(self) -> None:
        self.allow("website.settings.update")
        default = Theme.objects.get(code="default")
        alt = Theme.objects.create(
            code="alt",
            name="Alt",
            version="1.0.0",
            section_types=default.section_types,
            config_schema={
                "type": "object",
                "properties": {"accent": {"type": "string", "enum": ["blue", "green"]}},
            },
        )
        bad = self._patch({"theme_id": str(alt.id), "theme_config": {"accent": "red"}})
        self.assertEqual(bad.status_code, 422)
        self.assertIn("theme_config", bad.content.decode())
        good = self._patch({"theme_id": str(alt.id), "theme_config": {"accent": "blue"}})
        self.assertEqual(good.status_code, 200)
        self.assertEqual(good.json()["data"]["theme_code"], "alt")

    def test_unsafe_social_link_is_rejected(self) -> None:
        self.allow("website.settings.update")
        response = self._patch({"social_links": [{"platform": "x", "url": "javascript:alert(1)"}]})
        self.assertEqual(response.status_code, 422)
        self.assertIn("social_links.0.url", response.content.decode())

    def test_unsafe_link_in_header_config_is_rejected(self) -> None:
        self.allow("website.settings.update")
        response = self._patch(
            {"header_config": {"cta": {"label": "Apply", "href": "//evil.example"}}}
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("header_config.cta.href", response.content.decode())

    def test_safe_links_are_accepted(self) -> None:
        self.allow("website.settings.update")
        response = self._patch(
            {
                "social_links": [{"platform": "x", "url": "https://x.com/school"}],
                "header_config": {"cta": {"label": "Apply", "href": "/admissions"}},
            }
        )
        self.assertEqual(response.status_code, 200)


class ThemeListTests(WebsiteAPITestCase):
    def test_lists_active_themes_only(self) -> None:
        self.allow("website.page.view")
        default = Theme.objects.get(code="default")
        Theme.objects.create(
            code="retired",
            name="R",
            version="1.0.0",
            is_active=False,
            section_types=default.section_types,
        )
        response = self.client.get("/api/v1/themes")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([t["code"] for t in response.json()["data"]], ["default"])

    def test_requires_the_page_view_key(self) -> None:
        self.assertEqual(self.client.get("/api/v1/themes").status_code, 403)

    def test_bearer_token_alone_lists_themes(self) -> None:
        self.allow("website.page.view")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(self.user)}")
        response = client.get("/api/v1/themes")
        self.assertEqual(response.status_code, 200)
        self.assertIn("default", [t["code"] for t in response.json()["data"]])
