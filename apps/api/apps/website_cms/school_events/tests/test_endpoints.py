"""Endpoint tests for `/school-events`: CRUD, date range, slugs, lifecycle, file visibility."""

from __future__ import annotations

from unittest import mock

from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.website_cms.models import ContentStatus
from apps.website_cms.tests.base import WebsiteAPITestCase
from apps.website_cms.validation import validate_rich_text
from core.files.models import FileVisibility

LIST = "/api/v1/school-events"
START = "2026-12-01T09:00:00Z"
END = "2026-12-01T12:00:00Z"


def detail(event) -> str:
    return f"{LIST}/{event.id}"


def image_doc(file_id) -> dict:
    return {"blocks": [{"type": "image", "file_id": str(file_id), "alt": "Poster"}]}


class EventCrudTests(WebsiteAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow("website.page.view")

    def _create(self, **payload):
        return self.client.post(
            LIST,
            {"title": "Open day", "slug": "open-day", "starts_at": START, **payload},
            format="json",
        )

    def test_create_requires_the_create_key(self) -> None:
        self.assertEqual(self._create().status_code, 403)

    def test_create_makes_a_draft(self) -> None:
        self.allow("website.school-event.create")
        response = self._create(ends_at=END, location="Hall", is_all_day=False)
        self.assertEqual(response.status_code, 201)
        data = response.json()["data"]
        self.assertEqual(data["status"], "draft")
        self.assertEqual(data["location"], "Hall")

    def test_event_end_before_start_422(self) -> None:
        self.allow("website.school-event.create")
        response = self._create(starts_at=END, ends_at=START)
        self.assertEqual(response.status_code, 422)
        self.assertIn("end_before_start", response.content.decode())

    def test_patch_checks_the_merged_range(self) -> None:
        self.allow("website.school-event.update")
        event = self.make_event(starts_at="2026-12-01T09:00:00Z", ends_at="2026-12-01T12:00:00Z")
        response = self.client.patch(detail(event), {"starts_at": "2026-12-02T09:00:00Z"})
        self.assertEqual(response.status_code, 422)
        ok = self.client.patch(
            detail(event), {"ends_at": "2026-12-03T09:00:00Z", "starts_at": "2026-12-02T09:00:00Z"}
        )
        self.assertEqual(ok.status_code, 200)

    def test_equal_start_and_end_is_allowed(self) -> None:
        self.allow("website.school-event.create")
        self.assertEqual(self._create(ends_at=START).status_code, 201)

    def test_omitted_description_stores_a_valid_empty_document(self) -> None:
        self.allow("website.school-event.create")
        data = self._create().json()["data"]
        self.assertEqual(data["description"], {"blocks": []})
        validate_rich_text(data["description"])

    def test_description_must_be_rich_text(self) -> None:
        self.allow("website.school-event.create")
        self.assertEqual(self._create(description="<b>x</b>").status_code, 422)

    def test_cover_must_be_a_usable_file(self) -> None:
        self.allow("website.school-event.create")
        foreign = self.make_media(self.make_other_tenant())
        self.assertEqual(self._create(cover_image_file_id=str(foreign.id)).status_code, 422)

    def test_slug_rules(self) -> None:
        self.allow("website.school-event.create")
        for slug in ("Open", "a/b", "x" * 121):
            with self.subTest(slug=slug):
                self.assertEqual(self._create(slug=slug).status_code, 422)
        self.assertEqual(self._create().status_code, 201)
        self.assertEqual(self._create().status_code, 422)

    def test_patch_requires_the_update_key(self) -> None:
        event = self.make_event()
        self.assertEqual(self.client.patch(detail(event), {"title": "x"}).status_code, 403)
        self.allow("website.school-event.update")
        self.assertEqual(self.client.patch(detail(event), {"title": "x"}).status_code, 200)

    def test_there_is_no_delete(self) -> None:
        self.allow_everything()
        event = self.make_event()
        self.assertEqual(self.client.delete(detail(event)).status_code, 405)

    def test_list_filters_by_status(self) -> None:
        self.make_event(slug="a")
        self.make_event(slug="b", status=ContentStatus.PUBLISHED)
        rows = self.client.get(LIST, {"status": "published"}).json()["data"]
        self.assertEqual([r["slug"] for r in rows], ["b"])
        self.assertNotIn("description", rows[0])


class EventLifecycleTests(WebsiteAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow(
            "website.page.view", "website.school-event.publish", "website.school-event.update"
        )

    def _post(self, event, action: str):
        return self.client.post(f"{detail(event)}:{action}")

    def test_publish_unpublish_archive(self) -> None:
        event = self.make_event()
        self.assertEqual(self._post(event, "publish").json()["data"]["status"], "published")
        self.assertEqual(self._post(event, "unpublish").json()["data"]["status"], "draft")
        self.assertEqual(self._post(event, "archive").json()["data"]["status"], "archived")

    def test_publish_queues_revalidation_on_commit(self) -> None:
        event = self.make_event()
        with (
            mock.patch("apps.website_cms.revalidation.revalidate_website") as task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            self._post(event, "publish")
        task.delay.assert_called_once_with(str(self.tenant.id), [])

    def test_each_transition_requires_the_publish_key(self) -> None:
        event = self.make_event()
        self.sign_in_reader()
        for action in ("publish", "unpublish", "archive"):
            with self.subTest(action=action):
                self.assertEqual(self._post(event, action).status_code, 403)

    def test_publish_and_unpublish_move_cover_and_description_files(self) -> None:
        cover, inline = self.make_media(), self.make_media()
        event = self.make_event(cover_image_file_id=cover.id, description=image_doc(inline.id))
        self._post(event, "publish")
        self.assertEqual(self.file_visibility(cover), FileVisibility.PUBLIC)
        self.assertEqual(self.file_visibility(inline), FileVisibility.PUBLIC)
        self._post(event, "archive")
        self.assertEqual(self.file_visibility(cover), FileVisibility.PRIVATE)
        self.assertEqual(self.file_visibility(inline), FileVisibility.PRIVATE)

    def test_replacing_the_cover_of_a_published_event_reverts_the_old_file(self) -> None:
        old, new = self.make_media(), self.make_media()
        event = self.make_event(cover_image_file_id=old.id)
        self._post(event, "publish")
        self.client.patch(detail(event), {"cover_image_file_id": str(new.id)}, format="json")
        self.assertEqual(self.file_visibility(old), FileVisibility.PRIVATE)
        self.assertEqual(self.file_visibility(new), FileVisibility.PUBLIC)

    def test_every_write_locks_the_row_before_writing_it(self) -> None:
        event = self.make_event()
        calls = [
            ("update", lambda: self.client.patch(detail(event), {"title": "T"}, format="json")),
            ("publish", lambda: self._post(event, "publish")),
            ("unpublish", lambda: self._post(event, "unpublish")),
            ("archive", lambda: self._post(event, "archive")),
        ]
        for name, call in calls:
            with self.subTest(action=name), CaptureQueriesContext(connection) as queries:
                self.assertLess(call().status_code, 300)
                sql = [q["sql"] for q in queries.captured_queries]
                lock = next(
                    i for i, q in enumerate(sql) if "FOR UPDATE" in q and '"school_events"' in q
                )
                write = next(i for i, q in enumerate(sql) if q.startswith('UPDATE "school_events"'))
                self.assertLess(lock, write)
