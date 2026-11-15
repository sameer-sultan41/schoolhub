"""Endpoint tests for `/seo-settings`."""

from __future__ import annotations

from unittest import mock
from uuid import uuid4

from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.website_cms.models import ContentStatus, SeoSetting
from apps.website_cms.tests.base import WebsiteAPITestCase
from apps.website_cms.tests.factories import TenantFactory
from apps.website_cms.uploads import WEBSITE_MEDIA
from core.files.models import FileVisibility
from core.files.tests.factories import FileFactory
from core.tenancy.context import tenant_context

URL = "/api/v1/seo-settings"
PAGES = "/api/v1/website-pages"


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

    def test_news_event_album_targets_must_exist_for_this_tenant(self) -> None:
        self.allow("website.seo.update")
        rows = {
            "news_post": self.make_news(),
            "school_event": self.make_event(),
            "gallery_album": self.make_album(),
        }
        for target_type, row in rows.items():
            with self.subTest(target_type=target_type):
                missing = self._patch({"meta_title": "T"}, target_type, uuid4())
                self.assertEqual(missing.status_code, 422)
                self.assertIn("invalid_target", str(missing.json()))
                ok = self._patch({"meta_title": "T"}, target_type, row.id)
                self.assertEqual(ok.status_code, 200)
                self.assertEqual(ok.json()["data"]["meta_title"], "T")

    def test_og_image_of_published_content_is_public_and_reverts_on_unpublish(self) -> None:
        self.allow("website.seo.update", "website.news-post.publish")
        file = self.make_media()
        news = self.make_news()
        self._patch({"og_image_file_id": str(file.id)}, "news_post", news.id)
        self.assertEqual(self.file_visibility(file), FileVisibility.PRIVATE)
        self.client.post(f"/api/v1/news-posts/{news.id}:publish")
        self.assertEqual(self.file_visibility(file), FileVisibility.PUBLIC)
        self.client.post(f"/api/v1/news-posts/{news.id}:unpublish")
        self.assertEqual(self.file_visibility(file), FileVisibility.PRIVATE)

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

    def test_structured_data_is_read_only(self) -> None:
        self.allow("website.seo.update")
        payload = {"meta_title": "T", "structured_data": {"@type": "School", "name": "</script>"}}
        response = self._patch(payload)
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["data"]["structured_data"])
        with tenant_context(self.tenant.id):
            self.assertIsNone(SeoSetting.objects.get().structured_data)

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

        self.allow("website.page.publish")
        self.make_section(page, position=0)
        self.assertEqual(self.client.post(f"{PAGES}/{page.id}:publish").status_code, 200)
        with tenant_context(self.tenant.id):
            image.refresh_from_db()
        self.assertEqual(image.visibility, FileVisibility.PUBLIC)


class SeoCrossTenantTests(WebsiteAPITestCase):
    def test_another_tenants_page_is_not_a_valid_target(self) -> None:
        self.allow("website.page.view", "website.seo.update")
        other_page = self.make_page(tenant=TenantFactory(), slug="theirs")
        query = f"?target_type=page&target_id={other_page.id}"
        self.assertEqual(self.client.get(f"{URL}{query}").status_code, 422)
        patched = self.client.patch(f"{URL}{query}", {"meta_title": "T"}, format="json")
        self.assertEqual(patched.status_code, 422)


class SeoBearerOnlyTests(WebsiteAPITestCase):
    """L63: the view works under a bearer token with no session, as real clients call it."""

    def test_bearer_token_alone_reads_and_writes_and_a_foreign_target_is_unknown(self) -> None:
        self.allow("website.page.view", "website.seo.update")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(self.user)}")
        self.assertEqual(client.get(URL, {"target_type": "site"}).status_code, 200)
        patched = client.patch(f"{URL}?target_type=site", {"meta_title": "T"}, format="json")
        self.assertEqual(patched.status_code, 200)
        self.assertEqual(patched.json()["data"]["meta_title"], "T")

        foreign = self.make_page(tenant=TenantFactory(), slug="theirs")
        answers = []
        for target_id in (foreign.id, uuid4()):
            response = client.get(URL, {"target_type": "page", "target_id": str(target_id)})
            error = {k: v for k, v in response.json()["error"].items() if k != "request_id"}
            answers.append((response.status_code, error))
        self.assertEqual(answers[0], answers[1])
        self.assertEqual(answers[0][0], 422)
