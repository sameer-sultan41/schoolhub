"""Endpoint tests for `/gallery-albums` and its items: lifecycle, media rules, order, visibility."""

from __future__ import annotations

from unittest import mock
from uuid import uuid4

from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.website_cms.constants import EMBED_HOSTS, EMBED_URL_MAX_LENGTH, GALLERY_ALBUM_ITEMS_MAX
from apps.website_cms.models import ContentStatus, GalleryAlbum, GalleryItem
from apps.website_cms.tests.base import WebsiteAPITestCase
from core.files.models import FileVisibility
from core.tenancy.context import tenant_context

LIST = "/api/v1/gallery-albums"


def detail(album) -> str:
    return f"{LIST}/{album.id}"


def items_url(album) -> str:
    return f"{detail(album)}/gallery-items"


class AlbumCrudTests(WebsiteAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow("website.page.view")

    def _create(self, **payload):
        body = {"title": "Annual day", "slug": "annual-day", **payload}
        return self.client.post(LIST, body, format="json")

    def test_create_requires_the_create_key(self) -> None:
        self.assertEqual(self._create().status_code, 403)

    def test_create_makes_a_draft(self) -> None:
        self.allow("website.gallery-album.create")
        response = self._create(description="Photos")
        self.assertEqual(response.status_code, 201)
        data = response.json()["data"]
        self.assertEqual(data["status"], "draft")
        self.assertIsNone(data["school_event_id"])

    def test_slug_rules(self) -> None:
        self.allow("website.gallery-album.create")
        for slug in ("Annual", "a/b", "x" * 121):
            with self.subTest(slug=slug):
                self.assertEqual(self._create(slug=slug).status_code, 422)
        self.assertEqual(self._create().status_code, 201)
        self.assertEqual(self._create().status_code, 422)

    def test_album_event_link_must_be_this_tenants_event(self) -> None:
        self.allow("website.gallery-album.create", "website.gallery-album.update")
        mine = self.make_event()
        response = self._create(school_event_id=str(mine.id))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["data"]["school_event_id"], str(mine.id))
        theirs = self.make_event(self.make_other_tenant())
        for event_id in (theirs.id, uuid4()):
            with self.subTest(event_id=event_id):
                self.assertEqual(
                    self._create(slug="other", school_event_id=str(event_id)).status_code, 422
                )

    def test_patch_can_clear_the_event_link(self) -> None:
        self.allow("website.gallery-album.update")
        album = self.make_album(school_event=self.make_event())
        response = self.client.patch(detail(album), {"school_event_id": None}, format="json")
        self.assertIsNone(response.json()["data"]["school_event_id"])

    def test_patch_requires_the_update_key(self) -> None:
        album = self.make_album()
        self.assertEqual(self.client.patch(detail(album), {"title": "x"}).status_code, 403)

    def test_delete_requires_the_delete_key_and_an_unpublished_album(self) -> None:
        album = self.make_album(status=ContentStatus.PUBLISHED)
        self.assertEqual(self.client.delete(detail(album)).status_code, 403)
        self.allow("website.gallery-album.delete")
        self.assertEqual(self.client.delete(detail(album)).status_code, 422)
        draft = self.make_album()
        self.assertEqual(self.client.delete(detail(draft)).status_code, 204)

    def test_there_is_no_archive_route(self) -> None:
        self.allow_everything()
        album = self.make_album()
        self.assertEqual(self.client.post(f"{detail(album)}:archive").status_code, 404)


class AlbumLifecycleTests(WebsiteAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow(
            "website.page.view", "website.gallery-album.publish", "website.gallery-album.update"
        )

    def _post(self, album, action: str):
        return self.client.post(f"{detail(album)}:{action}")

    def test_publish_empty_album_422(self) -> None:
        album = self.make_album()
        response = self._post(album, "publish")
        self.assertEqual(response.status_code, 422)
        self.assertIn("empty_album", response.content.decode())
        album.refresh_from_db()
        self.assertEqual(album.status, ContentStatus.DRAFT)

    def test_publish_and_unpublish(self) -> None:
        album = self.make_album()
        self.make_item(album, position=0)
        data = self._post(album, "publish").json()["data"]
        self.assertEqual(data["status"], "published")
        self.assertIsNotNone(data["published_at"])
        data = self._post(album, "unpublish").json()["data"]
        self.assertEqual(data["status"], "draft")
        self.assertIsNone(data["published_at"])

    def test_publish_queues_revalidation_on_commit(self) -> None:
        album = self.make_album()
        self.make_item(album, position=0)
        with (
            mock.patch("apps.website_cms.revalidation.revalidate_website") as task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            self._post(album, "publish")
        task.delay.assert_called_once_with(str(self.tenant.id), [])

    def test_each_transition_requires_the_publish_key(self) -> None:
        album = self.make_album()
        self.sign_in_reader()
        for action in ("publish", "unpublish"):
            with self.subTest(action=action):
                self.assertEqual(self._post(album, action).status_code, 403)

    def test_publish_makes_cover_and_item_files_public_and_unpublish_reverts(self) -> None:
        cover, photo = self.make_media(), self.make_media()
        album = self.make_album(cover_image_file_id=cover.id)
        self.make_item(album, position=0, media_type="image", file_id=photo.id, embed_url="")
        self.assertEqual(self.file_visibility(photo), FileVisibility.PRIVATE)
        self._post(album, "publish")
        self.assertEqual(self.file_visibility(cover), FileVisibility.PUBLIC)
        self.assertEqual(self.file_visibility(photo), FileVisibility.PUBLIC)
        self._post(album, "unpublish")
        self.assertEqual(self.file_visibility(cover), FileVisibility.PRIVATE)
        self.assertEqual(self.file_visibility(photo), FileVisibility.PRIVATE)

    def test_replacing_the_cover_of_a_published_album_reverts_the_old_file(self) -> None:
        old, new = self.make_media(), self.make_media()
        album = self.make_album(cover_image_file_id=old.id)
        self.make_item(album, position=0)
        self._post(album, "publish")
        self.client.patch(detail(album), {"cover_image_file_id": str(new.id)}, format="json")
        self.assertEqual(self.file_visibility(old), FileVisibility.PRIVATE)
        self.assertEqual(self.file_visibility(new), FileVisibility.PUBLIC)

    def test_every_write_locks_the_row_before_writing_it(self) -> None:
        self.allow("website.gallery-album.delete")
        album = self.make_album()
        self.make_item(album, position=0)
        calls = [
            ("update", lambda: self.client.patch(detail(album), {"title": "T"}, format="json")),
            ("publish", lambda: self._post(album, "publish")),
            ("unpublish", lambda: self._post(album, "unpublish")),
            ("delete", lambda: self.client.delete(detail(album))),
        ]
        for name, call in calls:
            with self.subTest(action=name), CaptureQueriesContext(connection) as queries:
                self.assertLess(call().status_code, 300)
                sql = [q["sql"] for q in queries.captured_queries]
                lock = next(
                    i for i, q in enumerate(sql) if "FOR UPDATE" in q and '"gallery_albums"' in q
                )
                write = next(
                    i for i, q in enumerate(sql) if q.startswith('UPDATE "gallery_albums"')
                )
                self.assertLess(lock, write)


class ItemTests(WebsiteAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow("website.page.view", "website.gallery-album.update")
        self.album = self.make_album()

    def _add(self, **payload):
        return self.client.post(items_url(self.album), payload, format="json")

    def _video(self, url: str = "https://www.youtube.com/watch?v=abc", **extra):
        return self._add(media_type="video_embed", embed_url=url, **extra)

    def _patch(self, item_id, payload):
        return self.client.patch(f"{items_url(self.album)}/{item_id}", payload, format="json")

    def _positions(self) -> list[tuple[str, int]]:
        with tenant_context(self.tenant.id):
            rows = GalleryItem.objects.alive().filter(gallery_album=self.album)
            return [(str(r.id), r.position) for r in rows.order_by("position")]

    def test_writes_require_the_update_key(self) -> None:
        self.sign_in_reader()
        item = self.make_item(self.album, position=0)
        self.assertEqual(self._video().status_code, 403)
        self.assertEqual(self._patch(item.id, {"caption": "x"}).status_code, 403)
        self.assertEqual(self.client.delete(f"{items_url(self.album)}/{item.id}").status_code, 403)
        reorder = self.client.patch(f"{items_url(self.album)}:reorder", {"ids": []}, format="json")
        self.assertEqual(reorder.status_code, 403)
        self.assertEqual(self.client.get(items_url(self.album)).status_code, 200)

    def test_an_album_holds_at_most_the_item_cap(self) -> None:
        for position in range(GALLERY_ALBUM_ITEMS_MAX - 1):
            self.make_item(self.album, position=position)
        self.assertEqual(self._video().status_code, 201)
        response = self._video()
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["meta"]["reason"], "too_many_items")
        self.assertEqual(len(self._positions()), GALLERY_ALBUM_ITEMS_MAX)

    def test_image_item_requires_file(self) -> None:
        response = self._add(media_type="image")
        self.assertEqual(response.status_code, 422)
        self.assertIn("file_required", response.content.decode())

    def test_image_item_file_must_be_usable(self) -> None:
        foreign = self.make_media(self.make_other_tenant())
        self.assertEqual(self._add(media_type="image", file_id=str(foreign.id)).status_code, 422)
        mine = self.make_media()
        response = self._add(media_type="image", file_id=str(mine.id), caption="C", alt_text="A")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["data"]["file_id"], str(mine.id))

    def test_video_embed_requires_a_url(self) -> None:
        self.assertEqual(self._add(media_type="video_embed").status_code, 422)

    def test_video_embed_host_not_whitelisted_422(self) -> None:
        for url in (
            "https://evil.example.com/watch",
            "https://www.youtube.com.evil.example/x",
            "http://www.youtube.com/watch?v=abc",
            "javascript:alert(1)",
            "//www.youtube.com/x",
            "/relative",
        ):
            with self.subTest(url=url):
                self.assertEqual(self._video(url).status_code, 422)

    def test_video_embed_url_over_the_column_length_is_422_not_500(self) -> None:
        url = "https://www.youtube.com/watch?v=" + "a" * EMBED_URL_MAX_LENGTH
        response = self._video(url)
        self.assertEqual(response.status_code, 422)
        self.assertIn("invalid_url", response.content.decode())

    def test_video_embed_unparseable_url_is_422_not_500(self) -> None:
        self.assertEqual(self._video("https://[www.youtube.com/x").status_code, 422)

    def test_video_embed_accepts_every_whitelisted_host(self) -> None:
        for index, host in enumerate(sorted(EMBED_HOSTS)):
            with self.subTest(host=host):
                response = self._video(f"https://{host}/v/{index}")
                self.assertEqual(response.status_code, 201)

    def test_items_are_appended_in_order(self) -> None:
        for _ in range(3):
            self._video()
        self.assertEqual([p for _, p in self._positions()], [0, 1, 2])

    def test_patch_switching_type_clears_the_unused_field(self) -> None:
        photo = self.make_media()
        created = self._video().json()["data"]
        response = self._patch(created["id"], {"media_type": "image", "file_id": str(photo.id)})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["embed_url"], "")
        self.assertEqual(self._patch(created["id"], {"media_type": "video_embed"}).status_code, 422)

    def test_patch_checks_the_merged_item(self) -> None:
        created = self._video().json()["data"]
        bad = self._patch(created["id"], {"embed_url": "https://x.example/"})
        self.assertEqual(bad.status_code, 422)
        self.assertEqual(self._patch(created["id"], {"caption": "Nice"}).status_code, 200)

    def test_reorder_items(self) -> None:
        ids = [self._video().json()["data"]["id"] for _ in range(3)]
        wanted = [ids[2], ids[0], ids[1]]
        response = self.client.patch(
            f"{items_url(self.album)}:reorder", {"ids": wanted}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual([i["id"] for i in response.json()["data"]], wanted)
        self.assertEqual(self._positions(), [(wanted[0], 0), (wanted[1], 1), (wanted[2], 2)])

    def test_reorder_swap_does_not_collide_on_the_unique_position(self) -> None:
        first = self.make_item(self.album, position=0)
        second = self.make_item(self.album, position=1)
        response = self.client.patch(
            f"{items_url(self.album)}:reorder",
            {"ids": [str(second.id), str(first.id)]},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._positions(), [(str(second.id), 0), (str(first.id), 1)])

    def test_reorder_must_list_every_item_exactly_once(self) -> None:
        ids = [self._video().json()["data"]["id"] for _ in range(2)]
        url = f"{items_url(self.album)}:reorder"
        for bad in ([ids[0]], [ids[0], ids[0]], [*ids, str(uuid4())], [ids[0], str(uuid4())]):
            with self.subTest(ids=bad):
                response = self.client.patch(url, {"ids": bad}, format="json")
                self.assertEqual(response.status_code, 422)
        self.assertEqual([i for i, _ in self._positions()], ids)

    def test_reorder_rejects_another_albums_item(self) -> None:
        other = self.make_album(slug="other")
        foreign = self.make_item(other, position=0)
        mine = self._video().json()["data"]["id"]
        response = self.client.patch(
            f"{items_url(self.album)}:reorder", {"ids": [mine, str(foreign.id)]}, format="json"
        )
        self.assertEqual(response.status_code, 422)

    def test_deleting_gallery_item_reverts_its_file_visibility(self) -> None:
        self.allow("website.gallery-album.publish")
        photo = self.make_media()
        keep = self.make_item(self.album, position=0)
        item = self.make_item(
            self.album, position=1, media_type="image", file_id=photo.id, embed_url=""
        )
        self.client.post(f"{detail(self.album)}:publish")
        self.assertEqual(self.file_visibility(photo), FileVisibility.PUBLIC)
        with (
            mock.patch("apps.website_cms.revalidation.revalidate_website") as task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = self.client.delete(f"{items_url(self.album)}/{item.id}")
        self.assertEqual(response.status_code, 204)
        self.assertEqual(self.file_visibility(photo), FileVisibility.PRIVATE)
        task.delay.assert_called_once()
        with tenant_context(self.tenant.id):
            self.assertEqual(GalleryItem.objects.alive().filter(id=keep.id).count(), 1)

    def test_adding_an_item_to_a_published_album_makes_its_file_public(self) -> None:
        self.allow("website.gallery-album.publish")
        self.make_item(self.album, position=0)
        self.client.post(f"{detail(self.album)}:publish")
        photo = self.make_media()
        self._add(media_type="image", file_id=str(photo.id))
        self.assertEqual(self.file_visibility(photo), FileVisibility.PUBLIC)

    def test_replacing_an_items_file_of_a_published_album_reverts_the_old_file(self) -> None:
        self.allow("website.gallery-album.publish")
        old, new = self.make_media(), self.make_media()
        item = self.make_item(
            self.album, position=0, media_type="image", file_id=old.id, embed_url=""
        )
        self.client.post(f"{detail(self.album)}:publish")
        self.client.patch(
            f"{items_url(self.album)}/{item.id}", {"file_id": str(new.id)}, format="json"
        )
        self.assertEqual(self.file_visibility(old), FileVisibility.PRIVATE)
        self.assertEqual(self.file_visibility(new), FileVisibility.PUBLIC)

    def test_items_of_a_draft_album_keep_files_private(self) -> None:
        photo = self.make_media()
        self._add(media_type="image", file_id=str(photo.id))
        self.assertEqual(self.file_visibility(photo), FileVisibility.PRIVATE)

    def test_a_file_in_a_published_news_post_survives_an_item_delete(self) -> None:
        self.allow("website.gallery-album.publish", "website.news-post.publish")
        photo = self.make_media()
        post = self.make_news(cover_image_file_id=photo.id)
        self.client.post(f"/api/v1/news-posts/{post.id}:publish")
        item = self.make_item(
            self.album, position=0, media_type="image", file_id=photo.id, embed_url=""
        )
        self.client.post(f"{detail(self.album)}:publish")
        self.client.delete(f"{items_url(self.album)}/{item.id}")
        self.assertEqual(self.file_visibility(photo), FileVisibility.PUBLIC)

    def _reverse(self):
        ids = [i for i, _ in self._positions()]
        return self.client.patch(
            f"{items_url(self.album)}:reorder", {"ids": ids[::-1]}, format="json"
        )

    def test_every_item_write_locks_the_album_before_writing(self) -> None:
        item = self.make_item(self.album, position=0)
        other = self.make_item(self.album, position=1)
        patch_url = f"{items_url(self.album)}/{item.id}"
        calls = [
            ("create", self._video),
            ("update", lambda: self.client.patch(patch_url, {"caption": "c"}, format="json")),
            ("reorder", self._reverse),
            ("delete", lambda: self.client.delete(f"{items_url(self.album)}/{other.id}")),
        ]
        for name, call in calls:
            with self.subTest(action=name), CaptureQueriesContext(connection) as queries:
                self.assertLess(call().status_code, 300)
                sql = [q["sql"] for q in queries.captured_queries]
                lock = next(
                    i for i, q in enumerate(sql) if "FOR UPDATE" in q and '"gallery_albums"' in q
                )
                write = next(
                    i
                    for i, q in enumerate(sql)
                    if q.startswith(('INSERT INTO "gallery_items"', 'UPDATE "gallery_items"'))
                )
                self.assertLess(lock, write)


class GalleryBearerAndOrderTests(WebsiteAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow("website.page.view", "website.gallery-album.update")
        self.bearer = self.bearer_client()
        self.album = self.make_album()
        self.foreign = self.make_album(tenant=self.make_other_tenant())

    def test_bearer_token_alone_lists_404s_a_foreign_album_and_writes(self) -> None:
        self.assertEqual(self.bearer.get(LIST).status_code, 200)
        self.assertEqual(self.bearer.get(detail(self.foreign)).status_code, 404)
        response = self.bearer.patch(detail(self.album), {"title": "Renamed"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)

    def test_bearer_token_alone_reaches_items_and_a_foreign_album_is_404(self) -> None:
        item = self.make_item(self.album)
        self.assertEqual(self.bearer.get(items_url(self.album)).status_code, 200)
        self.assertEqual(self.bearer.get(items_url(self.foreign)).status_code, 404)
        response = self.bearer.patch(
            f"{items_url(self.album)}/{item.id}", {"caption": "Cheers"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)

    def test_albums_tied_on_every_sort_key_page_apart(self) -> None:
        rows = [self.album, self.make_album()]
        self.assert_ties_page_apart(LIST, GalleryAlbum, rows, created_at=timezone.now())

    def test_items_tied_on_created_at_page_apart(self) -> None:
        rows = [self.make_item(self.album), self.make_item(self.album)]
        self.assert_ties_page_apart(
            items_url(self.album),
            GalleryItem,
            rows,
            params={"ordering": "created_at"},
            created_at=timezone.now(),
        )


class PublishedAlbumEditGateTests(WebsiteAPITestCase):
    """§7.1: editing a published album or its items needs the publish key."""

    def setUp(self) -> None:
        super().setUp()
        self.allow("website.page.view", "website.gallery-album.update")
        self.live = self.make_album(slug="live", title="Live", status=ContentStatus.PUBLISHED)
        self.live_item = self.make_item(self.live, position=0)
        self.live_item2 = self.make_item(self.live, position=1)
        self.draft = self.make_album(slug="draft")
        self.draft_item = self.make_item(self.draft, position=0)

    def _writes(self, album, item):
        url = items_url(album)
        return {
            "album": lambda: self.client.patch(detail(album), {"title": "T"}, format="json"),
            "add": lambda: self.client.post(
                url,
                {"media_type": "video_embed", "embed_url": "https://www.youtube.com/watch?v=a"},
                format="json",
            ),
            "edit": lambda: self.client.patch(f"{url}/{item.id}", {"caption": "C"}, format="json"),
            "reorder": lambda: self.client.patch(
                f"{url}:reorder", {"ids": self._reversed_ids(album)}, format="json"
            ),
            "delete": lambda: self.client.delete(f"{url}/{item.id}"),
        }

    def _items(self, album):
        with tenant_context(self.tenant.id):
            rows = GalleryItem.objects.alive().filter(gallery_album=album)
            return list(rows.order_by("position"))

    def _reversed_ids(self, album) -> list[str]:
        return [str(i.id) for i in self._items(album)][::-1]

    def test_update_only_user_cannot_edit_a_published_album_or_its_items(self) -> None:
        for name, call in self._writes(self.live, self.live_item).items():
            with (
                self.subTest(write=name),
                mock.patch("apps.website_cms.revalidation.revalidate_website") as task,
                self.captureOnCommitCallbacks(execute=True),
            ):
                response = call()
                self.assertEqual(response.status_code, 422, response.content)
                self.assertIn("publish_required", response.json()["error"]["message"])
                task.delay.assert_not_called()
        self.live.refresh_from_db()
        self.assertEqual(self.live.title, "Live")
        self.assertEqual(len(self._items(self.live)), 2)

    def test_update_only_user_edits_a_draft_album_and_its_items(self) -> None:
        for name, call in self._writes(self.draft, self.draft_item).items():
            with self.subTest(write=name):
                self.assertLess(call().status_code, 300)

    def test_publisher_edits_a_published_album_and_its_items(self) -> None:
        self.allow("website.gallery-album.publish")
        for name, call in self._writes(self.live, self.live_item2).items():
            with self.subTest(write=name):
                self.assertLess(call().status_code, 300)
