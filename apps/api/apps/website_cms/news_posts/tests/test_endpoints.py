"""Endpoint tests for `/news-posts`: CRUD, slugs, rich-text body, lifecycle, file visibility."""

from __future__ import annotations

from unittest import mock

from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.website_cms.models import ContentStatus, NewsPost
from apps.website_cms.tests.base import WebsiteAPITestCase
from apps.website_cms.validation import validate_rich_text
from core.files.models import FileVisibility
from core.tenancy.context import tenant_context

LIST = "/api/v1/news-posts"


def detail(post) -> str:
    return f"{LIST}/{post.id}"


def body(*blocks: dict) -> dict:
    return {"blocks": list(blocks) or [{"type": "paragraph", "text": "Hello"}]}


def image_block(file_id) -> dict:
    return {"type": "image", "file_id": str(file_id), "alt": "A photo"}


class NewsCrudTests(WebsiteAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow("website.page.view")

    def _create(self, **payload):
        return self.client.post(
            LIST, {"title": "Sports day", "slug": "sports-day", **payload}, format="json"
        )

    def test_create_requires_the_create_key(self) -> None:
        self.assertEqual(self._create().status_code, 403)

    def test_list_requires_the_view_key(self) -> None:
        self.sign_in_reader()
        self.assertEqual(self.client.get(LIST).status_code, 200)

    def test_create_makes_a_draft(self) -> None:
        self.allow("website.news-post.create")
        response = self._create(body=body(), excerpt="Short")
        self.assertEqual(response.status_code, 201)
        data = response.json()["data"]
        self.assertEqual(data["status"], "draft")
        self.assertIsNone(data["published_at"])
        self.assertEqual(data["excerpt"], "Short")
        self.assertEqual(data["body"], body())

    def test_omitted_body_stores_a_valid_empty_document(self) -> None:
        self.allow("website.news-post.create")
        response = self._create()
        self.assertEqual(response.json()["data"]["body"], {"blocks": []})
        validate_rich_text(response.json()["data"]["body"])
        publish = self.client.post(f"{LIST}/{response.json()['data']['id']}:publish")
        self.assertEqual(publish.status_code, 200)

    def test_news_body_must_be_rich_text(self) -> None:
        self.allow("website.news-post.create")
        for bad in ("<p>html</p>", {"blocks": [{"type": "script", "text": "x"}]}, {"nope": 1}):
            with self.subTest(body=bad):
                self.assertEqual(self._create(body=bad).status_code, 422)

    def test_body_image_must_be_a_usable_file(self) -> None:
        self.allow("website.news-post.create")
        foreign = self.make_media(self.make_other_tenant())
        response = self._create(body=body(image_block(foreign.id)))
        self.assertEqual(response.status_code, 422)

    def test_cover_must_be_a_usable_file(self) -> None:
        self.allow("website.news-post.create")
        foreign = self.make_media(self.make_other_tenant())
        self.assertEqual(self._create(cover_image_file_id=str(foreign.id)).status_code, 422)
        mine = self.make_media()
        self.assertEqual(self._create(cover_image_file_id=str(mine.id)).status_code, 201)

    def test_malformed_slug_rejected(self) -> None:
        self.allow("website.news-post.create")
        for slug in ("Sports", "a b", "a/b", "-a", "x" * 121):
            with self.subTest(slug=slug):
                self.assertEqual(self._create(slug=slug).status_code, 422)

    def test_slug_unique_among_live_rows(self) -> None:
        self.allow("website.news-post.create", "website.news-post.delete")
        first = self._create().json()["data"]
        self.assertEqual(self._create().status_code, 422)
        self.assertEqual(self.client.delete(f"{LIST}/{first['id']}").status_code, 204)
        self.assertEqual(self._create().status_code, 201)

    def test_patch_updates_fields_and_requires_the_update_key(self) -> None:
        post = self.make_news(slug="old")
        self.assertEqual(self.client.patch(detail(post), {"title": "x"}).status_code, 403)
        self.allow("website.news-post.update")
        response = self.client.patch(detail(post), {"title": "New", "slug": "new"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["slug"], "new")

    def test_patch_to_a_taken_slug_is_422(self) -> None:
        self.allow("website.news-post.update")
        self.make_news(slug="taken")
        post = self.make_news(slug="mine")
        self.assertEqual(self.client.patch(detail(post), {"slug": "taken"}).status_code, 422)

    def test_patch_cannot_change_status(self) -> None:
        self.allow("website.news-post.update")
        post = self.make_news()
        self.client.patch(detail(post), {"status": "published"}, format="json")
        post.refresh_from_db()
        self.assertEqual(post.status, ContentStatus.DRAFT)

    def test_list_filters_by_status_and_omits_the_body(self) -> None:
        self.make_news(slug="a")
        self.make_news(slug="b", status=ContentStatus.PUBLISHED)
        rows = self.client.get(LIST, {"status": "published"}).json()["data"]
        self.assertEqual([r["slug"] for r in rows], ["b"])
        self.assertNotIn("body", rows[0])

    def test_delete_requires_the_delete_key_and_an_unpublished_post(self) -> None:
        post = self.make_news(status=ContentStatus.PUBLISHED)
        self.assertEqual(self.client.delete(detail(post)).status_code, 403)
        self.allow("website.news-post.delete")
        response = self.client.delete(detail(post))
        self.assertEqual(response.status_code, 422)
        self.assertIn("unpublish_first", response.content.decode())


class NewsLifecycleTests(WebsiteAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow("website.page.view", "website.news-post.publish", "website.news-post.update")

    def _post(self, post, action: str):
        return self.client.post(f"{detail(post)}:{action}")

    def test_publish_sets_status_and_published_at(self) -> None:
        post = self.make_news()
        data = self._post(post, "publish").json()["data"]
        self.assertEqual(data["status"], "published")
        self.assertIsNotNone(data["published_at"])

    def test_publish_queues_revalidation_on_commit(self) -> None:
        post = self.make_news()
        with (
            mock.patch("apps.website_cms.revalidation.revalidate_website") as task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            self._post(post, "publish")
        task.delay.assert_called_once_with(str(self.tenant.id), [])

    def test_publish_is_idempotent(self) -> None:
        post = self.make_news()
        first = self._post(post, "publish").json()["data"]["published_at"]
        self.assertEqual(self._post(post, "publish").json()["data"]["published_at"], first)

    def test_unpublish_returns_to_draft(self) -> None:
        post = self.make_news()
        self._post(post, "publish")
        data = self._post(post, "unpublish").json()["data"]
        self.assertEqual(data["status"], "draft")
        self.assertIsNone(data["published_at"])

    def test_archive_from_published_and_draft(self) -> None:
        for status in (ContentStatus.PUBLISHED, ContentStatus.DRAFT):
            with self.subTest(status=status):
                post = self.make_news(status=status)
                self.assertEqual(self._post(post, "archive").json()["data"]["status"], "archived")

    def test_each_transition_requires_the_publish_key(self) -> None:
        post = self.make_news()
        self.sign_in_reader()
        for action in ("publish", "unpublish", "archive"):
            with self.subTest(action=action):
                self.assertEqual(self._post(post, action).status_code, 403)

    def test_publish_makes_cover_and_body_images_public_and_unpublish_reverts(self) -> None:
        cover, inline = self.make_media(), self.make_media()
        post = self.make_news(cover_image_file_id=cover.id, body=body(image_block(inline.id)))
        self.assertEqual(self.file_visibility(cover), FileVisibility.PRIVATE)
        self._post(post, "publish")
        self.assertEqual(self.file_visibility(cover), FileVisibility.PUBLIC)
        self.assertEqual(self.file_visibility(inline), FileVisibility.PUBLIC)
        self._post(post, "unpublish")
        self.assertEqual(self.file_visibility(cover), FileVisibility.PRIVATE)
        self.assertEqual(self.file_visibility(inline), FileVisibility.PRIVATE)

    def test_archive_reverts_file_visibility(self) -> None:
        cover = self.make_media()
        post = self.make_news(cover_image_file_id=cover.id)
        self._post(post, "publish")
        self._post(post, "archive")
        self.assertEqual(self.file_visibility(cover), FileVisibility.PRIVATE)

    def test_a_file_shared_with_another_published_post_stays_public(self) -> None:
        cover = self.make_media()
        one = self.make_news(cover_image_file_id=cover.id)
        two = self.make_news(cover_image_file_id=cover.id)
        self._post(one, "publish")
        self._post(two, "publish")
        self._post(one, "unpublish")
        self.assertEqual(self.file_visibility(cover), FileVisibility.PUBLIC)

    def test_replacing_news_cover_reverts_old_file(self) -> None:
        old, new = self.make_media(), self.make_media()
        post = self.make_news(cover_image_file_id=old.id)
        self._post(post, "publish")
        payload = {"cover_image_file_id": str(new.id)}
        response = self.client.patch(detail(post), payload, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.file_visibility(old), FileVisibility.PRIVATE)
        self.assertEqual(self.file_visibility(new), FileVisibility.PUBLIC)

    def test_replacing_body_images_of_a_published_post_resyncs(self) -> None:
        old, new = self.make_media(), self.make_media()
        post = self.make_news(body=body(image_block(old.id)))
        self._post(post, "publish")
        self.client.patch(detail(post), {"body": body(image_block(new.id))}, format="json")
        self.assertEqual(self.file_visibility(old), FileVisibility.PRIVATE)
        self.assertEqual(self.file_visibility(new), FileVisibility.PUBLIC)

    def test_editing_a_draft_leaves_files_private(self) -> None:
        cover = self.make_media()
        post = self.make_news()
        self.client.patch(detail(post), {"cover_image_file_id": str(cover.id)}, format="json")
        self.assertEqual(self.file_visibility(cover), FileVisibility.PRIVATE)

    def test_body_image_ids_are_stored_canonically(self) -> None:
        file = self.make_media()
        post = self.make_news()
        upper = str(file.id).upper()
        self.client.patch(detail(post), {"body": body(image_block(upper))}, format="json")
        post.refresh_from_db()
        self.assertEqual(post.body["blocks"][0]["file_id"], str(file.id))
        self._post(post, "publish")
        self.assertEqual(self.file_visibility(file), FileVisibility.PUBLIC)

    def test_delete_soft_deletes_the_post(self) -> None:
        self.allow("website.news-post.delete")
        post = self.make_news()
        self.assertEqual(self.client.delete(detail(post)).status_code, 204)
        with tenant_context(self.tenant.id):
            self.assertFalse(NewsPost.objects.alive().filter(id=post.id).exists())

    def test_every_write_locks_the_row_before_writing_it(self) -> None:
        self.allow("website.news-post.delete")
        post = self.make_news()
        calls = [
            ("update", lambda: self.client.patch(detail(post), {"title": "T"}, format="json")),
            ("publish", lambda: self._post(post, "publish")),
            ("unpublish", lambda: self._post(post, "unpublish")),
            ("archive", lambda: self._post(post, "archive")),
            ("delete", lambda: self.client.delete(detail(post))),
        ]
        for name, call in calls:
            with self.subTest(action=name), CaptureQueriesContext(connection) as queries:
                self.assertLess(call().status_code, 300)
                sql = [q["sql"] for q in queries.captured_queries]
                lock = next(
                    i for i, q in enumerate(sql) if "FOR UPDATE" in q and '"news_posts"' in q
                )
                write = next(i for i, q in enumerate(sql) if q.startswith('UPDATE "news_posts"'))
                self.assertLess(lock, write)
