"""Endpoint tests for `/website-pages`: CRUD, slugs, publish workflow, sections, preview."""

from __future__ import annotations

from unittest import mock

from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.website_cms.constants import RESERVED_PAGE_SLUGS
from apps.website_cms.models import (
    ContentStatus,
    NavigationMenu,
    PageSection,
    PageType,
    WebsitePage,
)
from apps.website_cms.preview import read_preview_token
from apps.website_cms.tests.base import WebsiteAPITestCase
from apps.website_cms.uploads import WEBSITE_MEDIA
from core.files.models import File, FileVisibility
from core.files.tests.factories import FileFactory
from core.tenancy.context import tenant_context

LIST = "/api/v1/website-pages"


def detail(page) -> str:
    return f"{LIST}/{page.id}"


def hero(heading: str = "Welcome", **extra) -> dict:
    return {"section_type": "hero", "content": {"heading": heading, **extra}, "is_visible": True}


class PageCrudTests(WebsiteAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow("website.page.view")

    def _create(self, **payload):
        return self.client.post(LIST, {"title": "Fees", "slug": "fees", **payload}, format="json")

    def test_create_requires_the_create_key(self) -> None:
        self.assertEqual(self._create().status_code, 403)

    def test_create_makes_the_default_site_then_the_page(self) -> None:
        self.allow("website.page.create")
        response = self._create()
        self.assertEqual(response.status_code, 201)
        data = response.json()["data"]
        self.assertEqual(data["slug"], "fees")
        self.assertEqual(data["status"], "draft")
        self.assertEqual(data["page_type"], "standard")
        self.assertEqual(data["sections"], [])
        with tenant_context(self.tenant.id):
            self.assertEqual(WebsitePage.objects.alive().count(), 9)

    def test_a_second_home_page_is_refused(self) -> None:
        self.allow("website.page.create")
        self.assertEqual(self._create(page_type="home").status_code, 422)

    def test_reserved_slug_rejected(self) -> None:
        self.allow("website.page.create")
        for slug in sorted(RESERVED_PAGE_SLUGS):
            with self.subTest(slug=slug):
                self.assertEqual(self._create(slug=slug).status_code, 422)
        self.assertEqual(self._create(slug="news/archive").status_code, 422)

    def test_malformed_slug_rejected(self) -> None:
        self.allow("website.page.create")
        for slug in ("Fees", "a b", "/lead", "trail/", "a//b", "x" * 121):
            with self.subTest(slug=slug):
                self.assertEqual(self._create(slug=slug).status_code, 422)

    def test_nested_slug_accepted(self) -> None:
        self.allow("website.page.create")
        self.assertEqual(self._create(slug="about/history").status_code, 201)

    def test_slug_unique_per_locale_including_null(self) -> None:
        self.allow("website.page.create")
        self.assertEqual(self._create().status_code, 201)
        self.assertEqual(self._create().status_code, 422)
        self.assertEqual(self._create(locale="ur").status_code, 201)
        self.assertEqual(self._create(locale="ur").status_code, 422)

    def test_deleted_slug_can_be_reused(self) -> None:
        self.allow("website.page.create", "website.page.delete")
        page = self.client.post(LIST, {"title": "A", "slug": "a"}, format="json").json()["data"]
        self.assertEqual(self.client.delete(f"{LIST}/{page['id']}").status_code, 204)
        self.assertEqual(self._create(slug="a").status_code, 201)

    def test_patch_updates_title_and_slug(self) -> None:
        self.allow("website.page.update")
        page = self.make_page(slug="old")
        response = self.client.patch(detail(page), {"title": "New", "slug": "new"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["slug"], "new")

    def test_patch_cannot_change_page_type_or_status(self) -> None:
        self.allow("website.page.update")
        page = self.make_page(slug="p")
        self.client.patch(detail(page), {"page_type": "home", "status": "published"}, format="json")
        page.refresh_from_db()
        self.assertEqual(page.page_type, PageType.STANDARD)
        self.assertEqual(page.status, ContentStatus.DRAFT)

    def test_patch_to_a_taken_slug_is_422(self) -> None:
        self.allow("website.page.update")
        self.make_page(slug="taken")
        page = self.make_page(slug="mine")
        response = self.client.patch(detail(page), {"slug": "taken"}, format="json")
        self.assertEqual(response.status_code, 422)

    def test_patch_requires_the_update_key(self) -> None:
        page = self.make_page()
        self.assertEqual(self.client.patch(detail(page), {"title": "x"}).status_code, 403)

    def test_retrieve_returns_sections_in_order(self) -> None:
        page = self.make_page()
        self.make_section(page, position=1, content={"heading": "Second"})
        self.make_section(page, position=0, content={"heading": "First"})
        data = self.client.get(detail(page)).json()["data"]
        self.assertEqual([s["content"]["heading"] for s in data["sections"]], ["First", "Second"])
        self.assertEqual([s["position"] for s in data["sections"]], [0, 1])

    def test_delete_draft_page(self) -> None:
        self.allow("website.page.delete")
        page = self.make_page()
        self.assertEqual(self.client.delete(detail(page)).status_code, 204)
        self.assertEqual(self.client.get(detail(page)).status_code, 404)

    def test_delete_requires_the_delete_key(self) -> None:
        page = self.make_page()
        self.assertEqual(self.client.delete(detail(page)).status_code, 403)

    def test_delete_published_page_422(self) -> None:
        self.allow("website.page.delete")
        page = self.make_page(status=ContentStatus.PUBLISHED)
        response = self.client.delete(detail(page))
        self.assertEqual(response.status_code, 422)
        self.assertIn("unpublish_first", response.content.decode())

    def test_delete_homepage_422(self) -> None:
        self.allow("website.page.delete")
        page = self.make_page(slug="home", page_type=PageType.HOME)
        response = self.client.delete(detail(page))
        self.assertEqual(response.status_code, 422)
        self.assertIn("page_in_use", response.content.decode())

    def test_delete_navigation_target_422(self) -> None:
        self.allow("website.page.delete")
        page = self.make_page()
        with tenant_context(self.tenant.id):
            NavigationMenu.objects.create(
                tenant=self.tenant,
                location="header",
                items=[
                    {
                        "label": "More",
                        "target_type": "url",
                        "target": "/x",
                        "children": [{"label": "P", "target_type": "page", "target": str(page.id)}],
                    }
                ],
            )
        response = self.client.delete(detail(page))
        self.assertEqual(response.status_code, 422)
        self.assertIn("page_in_use", response.content.decode())

    def test_bearer_token_alone_reads_pages_and_unknown_id_is_404(self) -> None:
        mine = self.make_page(slug="mine")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(self.user)}")
        self.assertEqual(client.get(detail(mine)).status_code, 200)
        self.assertEqual(
            client.get(f"{LIST}/00000000-0000-0000-0000-000000000000").status_code, 404
        )


class PageListTests(WebsiteAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow("website.page.view")
        self.a = self.make_page(slug="a", title="Alpha")
        self.b = self.make_page(slug="b", title="Beta", status=ContentStatus.PUBLISHED)
        self.c = self.make_page(slug="c", title="Gamma", page_type=PageType.ABOUT)

    def _slugs(self, query: str = "") -> list[str]:
        response = self.client.get(f"{LIST}{query}")
        self.assertEqual(response.status_code, 200)
        return [row["slug"] for row in response.json()["data"]]

    def test_default_order_is_slug(self) -> None:
        self.assertEqual(self._slugs(), ["a", "b", "c"])

    def test_filters(self) -> None:
        self.assertEqual(self._slugs("?status=published"), ["b"])
        self.assertEqual(self._slugs("?page_type=about"), ["c"])

    def test_search_matches_title_and_slug(self) -> None:
        self.assertEqual(self._slugs("?search=gam"), ["c"])
        self.assertEqual(self._slugs("?search=b"), ["b"])

    def test_ordering_is_whitelisted(self) -> None:
        self.assertEqual(self._slugs("?ordering=-title"), ["c", "b", "a"])

    def test_pagination_uses_page_numbers_and_ties_are_stable(self) -> None:
        with tenant_context(self.tenant.id):
            WebsitePage.objects.alive().update(title="Same")
        seen = []
        for page in (1, 2, 3):
            body = self.client.get(f"{LIST}?ordering=title&page_size=1&page={page}").json()
            self.assertEqual(body["meta"]["pagination"]["total_count"], 3)
            seen.append(body["data"][0]["id"])
        self.assertEqual(len(set(seen)), 3)


class PublishWorkflowTests(WebsiteAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow("website.page.view", "website.page.publish")

    def _file(self):
        with tenant_context(self.tenant.id):
            return FileFactory(tenant=self.tenant, purpose=WEBSITE_MEDIA.key)

    def _visibility(self, file) -> str:
        with tenant_context(self.tenant.id):
            return File.objects.get(id=file.id).visibility

    def _post(self, page, action: str):
        return self.client.post(f"{detail(page)}:{action}")

    def test_publish_without_visible_sections_422(self) -> None:
        page = self.make_page()
        self.make_section(page, position=0, is_visible=False)
        response = self._post(page, "publish")
        self.assertEqual(response.status_code, 422)
        self.assertIn("no_visible_sections", response.content.decode())
        page.refresh_from_db()
        self.assertEqual(page.status, ContentStatus.DRAFT)

    def test_publish_sets_status_and_published_at(self) -> None:
        page = self.make_page()
        self.make_section(page, position=0)
        response = self._post(page, "publish")
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["status"], "published")
        self.assertIsNotNone(data["published_at"])

    def test_publish_queues_revalidation_on_commit(self) -> None:
        page = self.make_page()
        self.make_section(page, position=0)
        with (
            mock.patch("apps.website_cms.revalidation.revalidate_website") as task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            self._post(page, "publish")
        task.delay.assert_called_once_with(str(self.tenant.id), [])

    def test_publish_makes_referenced_files_public(self) -> None:
        file = self._file()
        page = self.make_page()
        self.make_section(page, position=0, content={"heading": "H", "image_file_id": str(file.id)})
        self.assertEqual(self._visibility(file), FileVisibility.PRIVATE)
        self._post(page, "publish")
        self.assertEqual(self._visibility(file), FileVisibility.PUBLIC)

    def test_unpublish_reverts_file_visibility(self) -> None:
        file = self._file()
        page = self.make_page()
        self.make_section(page, position=0, content={"heading": "H", "image_file_id": str(file.id)})
        self._post(page, "publish")
        response = self._post(page, "unpublish")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["status"], "draft")
        self.assertIsNone(response.json()["data"]["published_at"])
        self.assertEqual(self._visibility(file), FileVisibility.PRIVATE)

    def test_archive_reverts_file_visibility_and_queues_revalidation(self) -> None:
        file = self._file()
        page = self.make_page()
        self.make_section(page, position=0, content={"heading": "H", "image_file_id": str(file.id)})
        self._post(page, "publish")
        with (
            mock.patch("apps.website_cms.revalidation.revalidate_website") as task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = self._post(page, "archive")
        self.assertEqual(response.json()["data"]["status"], "archived")
        self.assertEqual(self._visibility(file), FileVisibility.PRIVATE)
        task.delay.assert_called_once()

    def test_every_transition_locks_the_page_row_before_writing_it(self) -> None:
        self.allow("website.page.delete")
        page = self.make_page()
        self.make_section(page, position=0)
        calls = [
            ("publish", lambda: self._post(page, "publish")),
            ("unpublish", lambda: self._post(page, "unpublish")),
            ("archive", lambda: self._post(page, "archive")),
            ("delete", lambda: self.client.delete(detail(page))),
        ]
        for name, call in calls:
            with self.subTest(action=name), CaptureQueriesContext(connection) as queries:
                self.assertLess(call().status_code, 300)
                sql = [q["sql"] for q in queries.captured_queries]
                lock = next(
                    i for i, q in enumerate(sql) if "FOR UPDATE" in q and '"website_pages"' in q
                )
                write = next(i for i, q in enumerate(sql) if q.startswith('UPDATE "website_pages"'))
                self.assertLess(lock, write)

    def test_archive_homepage_422(self) -> None:
        page = self.make_page(slug="home", page_type=PageType.HOME)
        self.assertEqual(self._post(page, "archive").status_code, 422)

    def test_each_transition_requires_the_publish_key(self) -> None:
        page = self.make_page()
        self.sign_in_reader()
        for action in ("publish", "unpublish", "archive"):
            with self.subTest(action=action):
                self.assertEqual(self._post(page, action).status_code, 403)

    def test_preview_requires_only_the_view_key_and_returns_a_token_url(self) -> None:
        self.sign_in_reader()
        page = self.make_page()
        response = self._post(page, "preview")
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertIn(f"{self.tenant.slug}.", data["url"])
        token = data["url"].split("token=", 1)[1]
        self.assertEqual(read_preview_token(token), (self.tenant.id, page.id))
        self.assertEqual(data["expires_in"], 600)


class ReplaceSectionsTests(WebsiteAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow("website.page.view", "website.page.update")
        self.page = self.make_page()

    def _put(self, sections: list[dict], page=None):
        return self.client.patch(
            f"{detail(page or self.page)}/page-sections", {"sections": sections}, format="json"
        )

    def _live(self, page=None) -> list[PageSection]:
        with tenant_context(self.tenant.id):
            return list(
                PageSection.objects.alive()
                .filter(website_page=page or self.page)
                .order_by("position")
            )

    def test_requires_the_update_key(self) -> None:
        self.sign_in_reader()
        self.assertEqual(self._put([hero()]).status_code, 403)

    def test_creates_sections_in_order(self) -> None:
        response = self._put([hero("One"), hero("Two")])
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual([s["content"]["heading"] for s in data], ["One", "Two"])
        self.assertEqual([s["position"] for s in data], [0, 1])
        self.assertEqual(len(self._live()), 2)

    def test_reorder_swaps_positions(self) -> None:
        first = self.make_section(self.page, position=0, content={"heading": "A"})
        second = self.make_section(self.page, position=1, content={"heading": "B"})
        response = self._put(
            [
                {**hero("B"), "id": str(second.id)},
                {**hero("A"), "id": str(first.id)},
            ]
        )
        self.assertEqual(response.status_code, 200)
        ids = [s["id"] for s in response.json()["data"]]
        self.assertEqual(ids, [str(second.id), str(first.id)])
        rows = {s.id: s.position for s in self._live()}
        self.assertEqual(rows, {second.id: 0, first.id: 1})

    def test_replace_sections_drops_removed_sections(self) -> None:
        keep = self.make_section(self.page, position=0, content={"heading": "Keep"})
        drop = self.make_section(self.page, position=1, content={"heading": "Drop"})
        response = self._put([{**hero("Keep"), "id": str(keep.id)}, hero("New")])
        self.assertEqual(response.status_code, 200)
        live_ids = {s.id for s in self._live()}
        self.assertIn(keep.id, live_ids)
        self.assertNotIn(drop.id, live_ids)
        self.assertEqual(len(live_ids), 2)

    def test_empty_list_removes_every_section(self) -> None:
        self.make_section(self.page, position=0)
        self.assertEqual(self._put([]).status_code, 200)
        self.assertEqual(self._live(), [])

    def test_invalid_content_is_422_keyed_by_section_index(self) -> None:
        response = self._put([hero("Fine"), {**hero(), "content": {"heading": ""}}])
        self.assertEqual(response.status_code, 422)
        self.assertIn("sections.1", response.content.decode())
        self.assertEqual(self._live(), [])

    def test_unsafe_link_in_content_is_422(self) -> None:
        response = self._put([hero(cta_href="javascript:alert(1)")])
        self.assertEqual(response.status_code, 422)

    def test_unknown_section_type_is_400(self) -> None:
        bad = {"section_type": "carousel", "content": {}, "is_visible": True}
        self.assertEqual(self._put([bad]).status_code, 400)

    def test_foreign_section_id_is_422(self) -> None:
        other = self.make_page(slug="other")
        theirs = self.make_section(other, position=0)
        response = self._put([{**hero(), "id": str(theirs.id)}])
        self.assertEqual(response.status_code, 422)

    def test_duplicate_section_id_is_422(self) -> None:
        mine = self.make_section(self.page, position=0)
        entry = {**hero(), "id": str(mine.id)}
        self.assertEqual(self._put([entry, entry]).status_code, 422)

    def test_too_many_sections_is_rejected(self) -> None:
        self.assertEqual(self._put([hero(str(i)) for i in range(51)]).status_code, 400)

    def test_file_must_be_a_ready_website_media_file(self) -> None:
        with tenant_context(self.tenant.id):
            wrong = FileFactory(tenant=self.tenant)
        response = self._put([hero(image_file_id=str(wrong.id))])
        self.assertEqual(response.status_code, 422)
        self.assertIn("file_id", response.content.decode())

    def test_replacing_sections_of_a_published_page_resyncs_visibility(self) -> None:
        self.allow("website.page.publish")
        with tenant_context(self.tenant.id):
            old = FileFactory(tenant=self.tenant, purpose=WEBSITE_MEDIA.key)
            new = FileFactory(tenant=self.tenant, purpose=WEBSITE_MEDIA.key)
        page = self.make_page(slug="live")
        section = self.make_section(
            page, position=0, content={"heading": "H", "image_file_id": str(old.id)}
        )
        self.assertEqual(self.client.post(f"{detail(page)}:publish").status_code, 200)
        with tenant_context(self.tenant.id):
            self.assertEqual(File.objects.get(id=old.id).visibility, FileVisibility.PUBLIC)
        self._put([{**hero(image_file_id=str(new.id)), "id": str(section.id)}], page=page)
        with tenant_context(self.tenant.id):
            self.assertEqual(File.objects.get(id=new.id).visibility, FileVisibility.PUBLIC)
            self.assertEqual(File.objects.get(id=old.id).visibility, FileVisibility.PRIVATE)

    def test_image_ids_are_stored_canonically_and_go_public_on_publish(self) -> None:
        self.allow("website.page.publish")
        with tenant_context(self.tenant.id):
            upper = FileFactory(tenant=self.tenant, purpose=WEBSITE_MEDIA.key)
            urn = FileFactory(tenant=self.tenant, purpose=WEBSITE_MEDIA.key)
        # Both spellings are 36 characters and parse as UUIDs, but neither is canonical.
        sections = [
            hero("One", image_file_id=str(upper.id).upper()),
            hero("Two", image_file_id=f"urn:{urn.id.hex}"),
        ]
        response = self._put(sections)
        self.assertEqual(response.status_code, 200)
        expected = [str(upper.id), str(urn.id)]
        returned = [s["content"]["image_file_id"] for s in response.json()["data"]]
        self.assertEqual(returned, expected)
        self.assertEqual([s.content["image_file_id"] for s in self._live()], expected)

        self.assertEqual(self.client.post(f"{detail(self.page)}:publish").status_code, 200)
        with tenant_context(self.tenant.id):
            for file in (upper, urn):
                self.assertEqual(File.objects.get(id=file.id).visibility, FileVisibility.PUBLIC)

    def test_unhyphenated_image_id_is_rejected_by_the_schema(self) -> None:
        with tenant_context(self.tenant.id):
            file = FileFactory(tenant=self.tenant, purpose=WEBSITE_MEDIA.key)
        response = self._put([hero(image_file_id=file.id.hex)])
        self.assertEqual(response.status_code, 422)
        self.assertIn("sections.0.image_file_id", response.content.decode())

    def test_replacing_sections_of_a_draft_leaves_files_private(self) -> None:
        with tenant_context(self.tenant.id):
            file = FileFactory(tenant=self.tenant, purpose=WEBSITE_MEDIA.key)
        self._put([hero(image_file_id=str(file.id))])
        with tenant_context(self.tenant.id):
            self.assertEqual(File.objects.get(id=file.id).visibility, FileVisibility.PRIVATE)

    def test_replacing_sections_of_a_published_page_queues_revalidation(self) -> None:
        page = self.make_page(slug="live", status=ContentStatus.PUBLISHED)
        with (
            mock.patch("apps.website_cms.revalidation.revalidate_website") as task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            self._put([hero()], page=page)
        task.delay.assert_called_once()
