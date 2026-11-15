"""Endpoint tests for `/seo-settings`."""

from __future__ import annotations

from unittest import mock
from uuid import uuid4

from apps.website_cms.models import ContentStatus, SeoSetting
from apps.website_cms.tests.base import WebsiteAPITestCase
from apps.website_cms.tests.factories import TenantFactory
from apps.website_cms.uploads import WEBSITE_MEDIA
from core.files.models import FileVisibility
from core.files.tests.factories import FileFactory
from core.tenancy.context import tenant_context

URL = "/api/v1/seo-settings"


class SeoReadTests(WebsiteAPITestCase):
    def test_read_requires_the_page_view_key(self) -> None:
        self.assertEqual(self.client.get(URL, {"target_type": "site"}).status_code, 403)

    def test_get_without_row_returns_unsaved_default_and_writes_nothing(self) -> None:
        self.allow("website.page.view")
        data = self.client.get(URL, {"target_type": "site"}).json()["data"]
        self.assertFalse(data["exists"])
        self.assertEqual(data["target_type"], "site")
        self.assertIsNone(data["meta_title"])
        with tenant_context(self.tenant.id):
            self.assertEqual(SeoSetting.objects.count(), 0)

    def test_get_page_target_returns_the_row(self) -> None:
        self.allow("website.page.view", "website.seo.update")
        page = self.make_page()
        params = {"target_type": "page", "target_id": str(page.id)}
        query = f"?target_type=page&target_id={page.id}"
        self.client.patch(f"{URL}{query}", {"meta_title": "T"}, format="json")
        data = self.client.get(URL, params).json()["data"]
        self.assertTrue(data["exists"])
        self.assertEqual(data["meta_title"], "T")

    def test_invalid_target_type_is_400(self) -> None:
        self.allow("website.page.view")
        self.assertEqual(self.client.get(URL, {"target_type": "nope"}).status_code, 400)


class SeoUpdateTests(WebsiteAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow("website.page.view")

    def _patch(self, payload, target_type="site", target_id=None):
        query = f"?target_type={target_type}" + (f"&target_id={target_id}" if target_id else "")
        return self.client.patch(f"{URL}{query}", payload, format="json")

    def test_patch_requires_the_seo_update_key(self) -> None:
        self.assertEqual(self._patch({"meta_title": "T"}).status_code, 403)

    def test_seo_upsert_idempotent(self) -> None:
        self.allow("website.seo.update")
        payload = {"meta_title": "School", "robots": "noindex"}
        with (
            mock.patch("apps.website_cms.revalidation.revalidate_website") as task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            first = self._patch(payload)
            second = self._patch(payload)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.json()["data"], first.json()["data"])
        with tenant_context(self.tenant.id):
            self.assertEqual(SeoSetting.objects.count(), 1)
        task.delay.assert_called_once_with(str(self.tenant.id), [])

    def test_partial_patch_keeps_other_fields_and_blank_clears(self) -> None:
        self.allow("website.seo.update")
        self._patch({"meta_title": "A", "meta_description": "B"})
        data = self._patch({"meta_title": ""}).json()["data"]
        self.assertIsNone(data["meta_title"])
        self.assertEqual(data["meta_description"], "B")

    def test_site_takes_no_target_id(self) -> None:
        self.allow("website.seo.update")
        response = self._patch({"meta_title": "T"}, "site", uuid4())
        self.assertEqual(response.status_code, 422)

    def test_seo_unknown_target_422(self) -> None:
        self.allow("website.seo.update")
        response = self._patch({"meta_title": "T"}, "page", uuid4())
        self.assertEqual(response.status_code, 422)
        self.assertIn("invalid_target", str(response.json()))

    def test_page_target_requires_an_id(self) -> None:
        self.allow("website.seo.update")
        self.assertEqual(self._patch({"meta_title": "T"}, "page").status_code, 422)

    def test_news_event_album_targets_are_unsupported_until_b1(self) -> None:
        self.allow("website.seo.update")
        for target_type in ("news_post", "school_event", "gallery_album"):
            with self.subTest(target_type=target_type):
                response = self._patch({"meta_title": "T"}, target_type, uuid4())
                self.assertEqual(response.status_code, 422)
                self.assertIn("unsupported_target", str(response.json()))

    def test_lengths_are_enforced(self) -> None:
        self.allow("website.seo.update")
        self.assertEqual(self._patch({"meta_title": "x" * 71}).status_code, 400)
        self.assertEqual(self._patch({"meta_description": "x" * 171}).status_code, 400)
        self.assertEqual(self._patch({"robots": "x" * 51}).status_code, 400)

    def test_canonical_url_must_be_safe(self) -> None:
        self.allow("website.seo.update")
        bad = self._patch({"canonical_url": "javascript:alert(1)"})
        self.assertEqual(bad.status_code, 422)
        self.assertIn("canonical_url", str(bad.json()))
        self.assertEqual(self._patch({"canonical_url": "https://school.example/"}).status_code, 200)

    def test_structured_data_must_be_an_object(self) -> None:
        self.allow("website.seo.update")
        self.assertEqual(self._patch({"structured_data": [1]}).status_code, 400)

    def test_og_image_must_be_a_ready_website_media_file(self) -> None:
        self.allow("website.seo.update")
        response = self._patch({"og_image_file_id": str(uuid4())})
        self.assertEqual(response.status_code, 422)

    def test_og_image_visibility_follows_the_site_row(self) -> None:
        self.allow("website.seo.update")
        with tenant_context(self.tenant.id):
            old = FileFactory(tenant=self.tenant, purpose=WEBSITE_MEDIA.key)
            new = FileFactory(tenant=self.tenant, purpose=WEBSITE_MEDIA.key)
        self.assertEqual(self._patch({"og_image_file_id": str(old.id)}).status_code, 200)
        self.assertEqual(self._patch({"og_image_file_id": str(new.id)}).status_code, 200)
        with tenant_context(self.tenant.id):
            old.refresh_from_db()
            new.refresh_from_db()
        self.assertEqual(new.visibility, FileVisibility.PUBLIC)
        self.assertEqual(old.visibility, FileVisibility.PRIVATE)

    def test_page_seo_og_image_public_only_once_page_is_published(self) -> None:
        self.allow("website.seo.update")
        page = self.make_page(status=ContentStatus.DRAFT)
        with tenant_context(self.tenant.id):
            image = FileFactory(tenant=self.tenant, purpose=WEBSITE_MEDIA.key)
        self._patch({"og_image_file_id": str(image.id)}, "page", page.id)
        with tenant_context(self.tenant.id):
            image.refresh_from_db()
        self.assertEqual(image.visibility, FileVisibility.PRIVATE)


class SeoCrossTenantTests(WebsiteAPITestCase):
    def test_another_tenants_page_is_not_a_valid_target(self) -> None:
        self.allow("website.page.view", "website.seo.update")
        other_page = self.make_page(tenant=TenantFactory(), slug="theirs")
        query = f"?target_type=page&target_id={other_page.id}"
        self.assertEqual(self.client.get(f"{URL}{query}").status_code, 422)
        patched = self.client.patch(f"{URL}{query}", {"meta_title": "T"}, format="json")
        self.assertEqual(patched.status_code, 422)
