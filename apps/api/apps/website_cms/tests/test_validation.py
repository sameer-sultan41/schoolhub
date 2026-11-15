"""Validation core: schema checks, links, file references, public media and visibility."""

from __future__ import annotations

from copy import deepcopy
from unittest import mock
from uuid import uuid4

from django.db import connection
from django.test import SimpleTestCase, TestCase, override_settings
from django.test.utils import CaptureQueriesContext

from apps.website_cms import visibility as website_visibility
from apps.website_cms.media import public_file_url, to_public, url_key
from apps.website_cms.models import ContentStatus
from apps.website_cms.tests.factories import (
    GalleryAlbumFactory,
    GalleryItemFactory,
    NewsPostFactory,
    PageSectionFactory,
    SchoolEventFactory,
    SeoSettingFactory,
    TenantFactory,
    WebsitePageFactory,
    default_theme,
)
from apps.website_cms.uploads import WEBSITE_MEDIA
from apps.website_cms.validation import (
    assert_files_usable,
    format_checker,
    is_safe_url,
    referenced_file_ids,
    validate_rich_text,
    validate_section_content,
)
from core.api.exceptions import DomainRuleViolation
from core.files.models import File, FileStatus, FileVisibility
from core.files.tests.factories import FileFactory
from core.files.visibility import sync_file_visibility
from core.tenancy.context import tenant_context


def _fields(exc: DomainRuleViolation) -> set[str]:
    return set(exc.detail)


class SectionContentTests(TestCase):
    def setUp(self) -> None:
        self.theme = default_theme()

    def test_valid_content_passes(self) -> None:
        validate_section_content(self.theme, "hero", {"heading": "Welcome"})

    def test_unknown_section_type_rejected(self) -> None:
        with self.assertRaises(DomainRuleViolation) as ctx:
            validate_section_content(self.theme, "carousel", {})
        self.assertEqual(_fields(ctx.exception), {"section_type"})

    def test_schema_error_reports_json_path(self) -> None:
        content = {"items": [{"question": "Why?", "answer": "ok"}, {"question": "Who?"}]}
        with self.assertRaises(DomainRuleViolation) as ctx:
            validate_section_content(self.theme, "faq", content)
        self.assertIn("items.1", " ".join(_fields(ctx.exception)))

    def test_missing_required_property_reports_the_root(self) -> None:
        with self.assertRaises(DomainRuleViolation) as ctx:
            validate_section_content(self.theme, "hero", {})
        self.assertEqual(_fields(ctx.exception), {"non_field"})

    def test_validator_enforces_format_checker(self) -> None:
        content = {"heading": "Hi", "cta_href": "javascript:alert(1)"}
        with self.assertRaises(DomainRuleViolation) as ctx:
            validate_section_content(self.theme, "hero", content)
        self.assertEqual(_fields(ctx.exception), {"cta_href"})
        validate_section_content(self.theme, "hero", {"heading": "Hi", "cta_href": "/apply"})

    def test_non_uuid_image_value_rejected_at_its_path(self) -> None:
        content = {"heading": "Hi", "image_file_id": "not-a-uuid"}
        with self.assertRaises(DomainRuleViolation) as ctx:
            validate_section_content(self.theme, "hero", content)
        self.assertEqual(_fields(ctx.exception), {"image_file_id"})

    def test_image_values_are_rewritten_canonically_in_place(self) -> None:
        file_id = uuid4()
        content = {"heading": "Hi", "image_file_id": str(file_id).upper()}
        validate_section_content(self.theme, "hero", content)
        self.assertEqual(content["image_file_id"], str(file_id))

    def test_rich_text_image_block_is_rewritten_canonically(self) -> None:
        file_id = uuid4()
        doc = {"blocks": [{"type": "image", "file_id": f"urn:{file_id.hex}"}]}
        validate_rich_text(doc)
        self.assertEqual(doc["blocks"][0]["file_id"], str(file_id))


class RichTextTests(TestCase):
    def test_valid_document_passes(self) -> None:
        doc = {
            "blocks": [
                {"type": "heading", "level": 2, "text": "Title"},
                {"type": "paragraph", "text": "Body"},
                {"type": "list", "ordered": False, "items": ["a", "b"]},
                {"type": "quote", "text": "Q"},
                {"type": "image", "file_id": str(uuid4()), "alt": "A photo"},
            ]
        }
        validate_rich_text(doc)

    def test_rich_text_rejects_html_block_type(self) -> None:
        with self.assertRaises(DomainRuleViolation) as ctx:
            validate_rich_text({"blocks": [{"type": "html", "text": "<script>x</script>"}]})
        self.assertIn("blocks.0", _fields(ctx.exception))

    def test_heading_level_outside_2_to_4_rejected(self) -> None:
        for level in (1, 5):
            with self.subTest(level=level), self.assertRaises(DomainRuleViolation):
                validate_rich_text({"blocks": [{"type": "heading", "level": level, "text": "x"}]})

    def test_section_body_is_validated_through_the_ref(self) -> None:
        body = {"blocks": [{"type": "html", "text": "x"}]}
        with self.assertRaises(DomainRuleViolation) as ctx:
            validate_section_content(default_theme(), "rich_text", {"body": body})
        self.assertIn("body.blocks.0", _fields(ctx.exception))

    def test_non_uuid_image_block_rejected(self) -> None:
        with self.assertRaises(DomainRuleViolation):
            validate_rich_text({"blocks": [{"type": "image", "file_id": "x" * 36}]})


class ReferencedFileIdsTests(TestCase):
    def setUp(self) -> None:
        self.theme = default_theme()

    def test_image_property_is_referenced(self) -> None:
        file_id = uuid4()
        schema = self.theme.section_types["hero"]["schema"]
        content = {"heading": "Hi", "image_file_id": str(file_id)}
        self.assertEqual(referenced_file_ids(schema, content), {file_id})

    def test_rich_text_image_block_file_id_is_referenced(self) -> None:
        file_id = uuid4()
        schema = self.theme.section_types["rich_text"]["schema"]
        blocks = [{"type": "paragraph", "text": "x"}, {"type": "image", "file_id": str(file_id)}]
        body = {"blocks": blocks}
        self.assertEqual(referenced_file_ids(schema, {"body": body}), {file_id})

    def test_nothing_referenced_without_images(self) -> None:
        schema = self.theme.section_types["faq"]["schema"]
        self.assertEqual(referenced_file_ids(schema, {"items": []}), set())

    def test_empty_or_null_reference_is_skipped(self) -> None:
        schema = self.theme.section_types["hero"]["schema"]
        self.assertEqual(referenced_file_ids(schema, {"image_file_id": ""}), set())


class AssertFilesUsableTests(TestCase):
    def setUp(self) -> None:
        self.tenant = TenantFactory()
        self.other = TenantFactory()
        with tenant_context(self.other.id):
            self.theirs = FileFactory(tenant=self.other, purpose=WEBSITE_MEDIA.key)
        with tenant_context(self.tenant.id):
            self.ready = FileFactory(tenant=self.tenant, purpose=WEBSITE_MEDIA.key)
            self.pending = FileFactory(
                tenant=self.tenant, purpose=WEBSITE_MEDIA.key, status=FileStatus.PENDING
            )
            self.wrong_purpose = FileFactory(tenant=self.tenant)

    def test_ready_website_media_passes(self) -> None:
        with tenant_context(self.tenant.id):
            assert_files_usable([self.ready.id, str(self.ready.id)])

    def test_other_tenant_file_id_rejected(self) -> None:
        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation):
            assert_files_usable([self.theirs.id])

    def test_pending_file_rejected(self) -> None:
        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation):
            assert_files_usable([self.pending.id])

    def test_other_purpose_rejected(self) -> None:
        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation):
            assert_files_usable([self.wrong_purpose.id])

    def test_unknown_id_rejected(self) -> None:
        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation):
            assert_files_usable([uuid4()])

    def test_non_uuid_string_is_a_422_not_a_500(self) -> None:
        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation) as ctx:
            assert_files_usable(["../../etc/passwd"])
        self.assertEqual(_fields(ctx.exception), {"file_id"})

    def test_no_ids_is_fine(self) -> None:
        with tenant_context(self.tenant.id):
            assert_files_usable([])


class SafeUrlTests(SimpleTestCase):
    def test_safe_url_rejects_javascript_data_and_protocol_relative(self) -> None:
        for value in (
            "javascript:alert(1)",
            "data:text/html,x",
            "//evil.test",
            "http://x",
            "/\\evil.test",
            "https://",
            "https://ex ample.test",
            "",
            "mailto:a@b.test",
            "https://[x",
            "https://[::1",
        ):
            with self.subTest(value=value):
                self.assertFalse(is_safe_url(value))

    def test_safe_url_accepts_https_and_relative(self) -> None:
        for value in ("https://school.test/about", "/about", "/", "/news?page=2#top"):
            with self.subTest(value=value):
                self.assertTrue(is_safe_url(value))

    def test_format_checker_ignores_non_strings(self) -> None:
        self.assertTrue(format_checker().conforms(5, "safe-url"))


@override_settings(API_PUBLIC_URL="https://api.schools.example/")
class ToPublicTests(TestCase):
    def setUp(self) -> None:
        self.theme = default_theme()
        self.tenant_id = uuid4()

    def test_to_public_rewrites_nested_file_ids(self) -> None:
        hero_id, block_id = uuid4(), uuid4()
        hero = self.theme.section_types["hero"]["schema"]
        rich = self.theme.section_types["rich_text"]["schema"]

        out = to_public(hero, {"heading": "Hi", "image_file_id": str(hero_id)}, self.tenant_id)
        self.assertEqual(
            out,
            {"heading": "Hi", "image_url": public_file_url(self.tenant_id, hero_id)},
        )
        self.assertEqual(
            out["image_url"],
            f"https://api.schools.example/api/v1/public/files/{self.tenant_id}/{hero_id}",
        )

        body = {"blocks": [{"type": "image", "file_id": str(block_id), "alt": "A"}]}
        nested = to_public(rich, {"body": body}, self.tenant_id)
        self.assertEqual(
            nested["body"]["blocks"][0],
            {"type": "image", "alt": "A", "file_url": public_file_url(self.tenant_id, block_id)},
        )

    def test_input_is_not_mutated(self) -> None:
        hero = self.theme.section_types["hero"]["schema"]
        content = {"heading": "Hi", "image_file_id": str(uuid4())}
        before = deepcopy(content)
        to_public(hero, content, self.tenant_id)
        self.assertEqual(content, before)

    def test_empty_reference_is_dropped(self) -> None:
        hero = self.theme.section_types["hero"]["schema"]
        out = to_public(hero, {"heading": "Hi", "image_file_id": ""}, self.tenant_id)
        self.assertEqual(out, {"heading": "Hi"})

    def test_a_slot_shared_by_two_one_of_branches_is_rewritten_once(self) -> None:
        image = {"type": "string", "x-widget": "image"}
        schema = {"oneOf": [{"properties": {"image_file_id": image}}] * 2}
        file_id = uuid4()
        out = to_public(schema, {"image_file_id": str(file_id)}, self.tenant_id)
        self.assertEqual(out, {"image_url": public_file_url(self.tenant_id, file_id)})

    def test_url_key_naming(self) -> None:
        self.assertEqual(url_key("image_file_id"), "image_url")
        self.assertEqual(url_key("file_id"), "file_url")
        self.assertEqual(url_key("image"), "image_url")


class SyncVisibilityTests(TestCase):
    """The website providers behind `core.files.visibility.sync_file_visibility`."""

    def setUp(self) -> None:
        self.tenant = TenantFactory()
        self.ctx = tenant_context(self.tenant.id)
        self.ctx.__enter__()
        self.addCleanup(self.ctx.__exit__, None, None, None)
        default_theme()
        self.file = FileFactory(tenant=self.tenant, purpose=WEBSITE_MEDIA.key)

    def _page_with_image(self, status: str = ContentStatus.PUBLISHED):
        page = WebsitePageFactory(tenant=self.tenant, status=status)
        PageSectionFactory(
            tenant=self.tenant,
            website_page=page,
            content={"heading": "Hi", "image_file_id": str(self.file.id)},
        )
        return page

    def _visibility(self) -> str:
        return File.objects.get(id=self.file.id).visibility

    def test_published_reference_makes_the_file_public(self) -> None:
        self._page_with_image()
        sync_file_visibility([self.file.id])
        self.assertEqual(self._visibility(), FileVisibility.PUBLIC)

    def test_draft_reference_keeps_the_file_private(self) -> None:
        self._page_with_image(ContentStatus.DRAFT)
        sync_file_visibility([self.file.id])
        self.assertEqual(self._visibility(), FileVisibility.PRIVATE)

    def test_sync_visibility_reverts_when_last_reference_unpublished(self) -> None:
        page = self._page_with_image()
        sync_file_visibility([self.file.id])
        page.status = ContentStatus.DRAFT
        page.save(update_fields=["status"])
        sync_file_visibility([self.file.id])
        self.assertEqual(self._visibility(), FileVisibility.PRIVATE)

    def test_sync_visibility_keeps_public_while_another_published_row_references(self) -> None:
        first = self._page_with_image()
        self._page_with_image()
        sync_file_visibility([self.file.id])
        first.status = ContentStatus.DRAFT
        first.save(update_fields=["status"])
        sync_file_visibility([self.file.id])
        self.assertEqual(self._visibility(), FileVisibility.PUBLIC)

    def test_hidden_section_does_not_keep_the_file_public(self) -> None:
        page = self._page_with_image()
        page.sections.update(is_visible=False)
        sync_file_visibility([self.file.id])
        self.assertEqual(self._visibility(), FileVisibility.PRIVATE)

    def test_site_og_image_is_public(self) -> None:
        SeoSettingFactory(tenant=self.tenant, og_image_file_id=self.file.id)
        sync_file_visibility([self.file.id])
        self.assertEqual(self._visibility(), FileVisibility.PUBLIC)

    def test_page_og_image_follows_the_pages_status(self) -> None:
        page = WebsitePageFactory(tenant=self.tenant, status=ContentStatus.DRAFT)
        SeoSettingFactory(
            tenant=self.tenant,
            target_type="page",
            target_id=page.id,
            og_image_file_id=self.file.id,
        )
        sync_file_visibility([self.file.id])
        self.assertEqual(self._visibility(), FileVisibility.PRIVATE)
        page.status = ContentStatus.PUBLISHED
        page.save(update_fields=["status"])
        sync_file_visibility([self.file.id])
        self.assertEqual(self._visibility(), FileVisibility.PUBLIC)

    def test_sections_not_mentioning_a_candidate_are_not_loaded_or_walked(self) -> None:
        page = self._page_with_image()
        PageSectionFactory(
            tenant=self.tenant,
            website_page=page,
            content={"heading": "Unrelated", "image_file_id": str(uuid4())},
        )
        with mock.patch.object(
            website_visibility,
            "referenced_file_ids",
            wraps=website_visibility.referenced_file_ids,
        ) as walk:
            claimed = website_visibility.page_section_files({self.file.id})
        self.assertEqual(claimed, {self.file.id})
        self.assertEqual(walk.call_count, 1)

    def test_no_candidates_runs_no_query(self) -> None:
        with self.assertNumQueries(0):
            self.assertEqual(website_visibility.page_section_files(set()), set())


class ProviderNarrowingTests(TestCase):
    """The news, event and gallery providers load only what can mention a candidate (L71)."""

    def setUp(self) -> None:
        self.tenant = TenantFactory()
        self.ctx = tenant_context(self.tenant.id)
        self.ctx.__enter__()
        self.addCleanup(self.ctx.__exit__, None, None, None)
        self.file = FileFactory(tenant=self.tenant, purpose=WEBSITE_MEDIA.key)

    @staticmethod
    def _doc(file_id) -> dict:
        return {"blocks": [{"type": "image", "file_id": str(file_id), "alt": "Photo"}]}

    def _walked_rows(self, provider, factory, field: str) -> tuple[set, int]:
        """The provider's answer and how many rows its confirming walk ran on."""
        status = ContentStatus.PUBLISHED
        factory(tenant=self.tenant, status=status, **{field: self._doc(self.file.id)})
        factory(tenant=self.tenant, status=status, **{field: self._doc(uuid4())})
        factory(tenant=self.tenant, status=status)
        with mock.patch.object(
            website_visibility,
            "rich_text_file_ids",
            wraps=website_visibility.rich_text_file_ids,
        ) as walk:
            return provider({self.file.id}), walk.call_count

    def test_news_walks_only_the_post_that_mentions_the_candidate(self) -> None:
        claimed, walked = self._walked_rows(website_visibility.news_files, NewsPostFactory, "body")
        self.assertEqual((claimed, walked), ({self.file.id}, 1))

    def test_events_walk_only_the_event_that_mentions_the_candidate(self) -> None:
        claimed, walked = self._walked_rows(
            website_visibility.event_files, SchoolEventFactory, "description"
        )
        self.assertEqual((claimed, walked), ({self.file.id}, 1))

    def test_draft_rows_mentioning_the_candidate_are_not_walked(self) -> None:
        NewsPostFactory(tenant=self.tenant, body=self._doc(self.file.id))
        with mock.patch.object(website_visibility, "rich_text_file_ids") as walk:
            self.assertEqual(website_visibility.news_files({self.file.id}), set())
        walk.assert_not_called()

    def test_gallery_answers_from_two_id_filtered_queries(self) -> None:
        album = GalleryAlbumFactory(tenant=self.tenant, status=ContentStatus.PUBLISHED)
        GalleryItemFactory(
            tenant=self.tenant, gallery_album=album, media_type="image", file_id=self.file.id
        )
        for _ in range(3):
            other = GalleryAlbumFactory(tenant=self.tenant, status=ContentStatus.PUBLISHED)
            GalleryItemFactory(
                tenant=self.tenant,
                gallery_album=other,
                media_type="image",
                file_id=FileFactory(tenant=self.tenant, purpose=WEBSITE_MEDIA.key).id,
            )
        with CaptureQueriesContext(connection) as queries:
            claimed = website_visibility.gallery_files({self.file.id})
        self.assertEqual(claimed, {self.file.id})
        self.assertEqual(len(queries), 2)
        # Every query is narrowed to the candidate id in SQL, not filtered after loading.
        for query in queries.captured_queries:
            sql = query["sql"]
            self.assertIn(str(self.file.id), sql)
            self.assertTrue("file_id" in sql and " IN (" in sql, sql)

    def test_an_item_of_an_unpublished_album_is_not_claimed(self) -> None:
        draft = GalleryAlbumFactory(tenant=self.tenant)
        GalleryItemFactory(
            tenant=self.tenant, gallery_album=draft, media_type="image", file_id=self.file.id
        )
        self.assertEqual(website_visibility.gallery_files({self.file.id}), set())

    def test_no_candidates_run_no_query_in_any_provider(self) -> None:
        for provider in (
            website_visibility.news_files,
            website_visibility.event_files,
            website_visibility.gallery_files,
        ):
            with self.assertNumQueries(0):
                self.assertEqual(provider(set()), set())
