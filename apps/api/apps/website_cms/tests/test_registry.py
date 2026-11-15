"""The module's code-declared registries: permission keys, feature flag, upload purpose, themes."""

from __future__ import annotations

import copy
import json
from unittest import mock

from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.website_cms import themes
from apps.website_cms.constants import (
    SCHEMA_KEYWORDS,
    SCHEMA_WIDGETS,
    SectionType,
)
from apps.website_cms.models import PageType, Theme, WebsitePage
from apps.website_cms.tests.factories import TenantFactory, WebsitePageFactory
from core.files.purposes import registry as upload_registry
from core.rbac.registry import registry as permission_registry
from core.tenancy.context import tenant_context
from core.tenancy.features import registry as feature_registry

# docs/03-modules/website-cms.md §4, with the "a / b / c" shorthand expanded.
SECTION_4_KEYS = {
    "website.page.view",
    "website.page.create",
    "website.page.update",
    "website.page.delete",
    "website.page.publish",
    "website.news-post.create",
    "website.news-post.update",
    "website.news-post.delete",
    "website.news-post.publish",
    "website.school-event.create",
    "website.school-event.update",
    "website.school-event.publish",
    "website.gallery-album.create",
    "website.gallery-album.update",
    "website.gallery-album.publish",
    "website.gallery-album.delete",
    "website.navigation.update",
    "website.settings.update",
    "website.seo.update",
    "website.custom-domain.create",
    "website.custom-domain.update",
    "website.custom-domain.delete",
    "website.contact-submission.view",
    "website.contact-submission.update",
}

THEME_V1_SECTION_TYPES = {
    "hero",
    "about_school",
    "principal_message",
    "departments_grid",
    "teachers_grid",
    "classes_list",
    "admissions_cta",
    "events_list",
    "news_list",
    "notice_board",
    "gallery",
    "contact_form",
    "rich_text",
    "faq",
}


def _walk(schema, path="$"):
    """Yield (path, node) for every schema node, descending properties and items."""
    yield path, schema
    for name, child in (schema.get("properties") or {}).items():
        yield from _walk(child, f"{path}.{name}")
    items = schema.get("items")
    if isinstance(items, dict):
        yield from _walk(items, f"{path}[]")


class PermissionRegistryTests(TestCase):
    def test_every_section4_key_is_registered(self) -> None:
        registered = {spec.key for spec in permission_registry.for_module("website")}
        self.assertEqual(registered, SECTION_4_KEYS)

    def test_public_content_scope_is_not_a_role_permission(self) -> None:
        # Decision 1: the renderer's scope is a machine scope, never a grantable key.
        self.assertNotIn("website.public-content.view", permission_registry)

    def test_every_key_has_a_default_role(self) -> None:
        for spec in permission_registry.for_module("website"):
            self.assertTrue(spec.default_roles, spec.key)


class FeatureAndUploadTests(TestCase):
    def test_module_flag_is_registered_and_off_by_default(self) -> None:
        self.assertIn("module.website", feature_registry.keys)

    def test_website_media_purpose(self) -> None:
        spec = upload_registry.get("website.media")
        self.assertIsNotNone(spec)
        self.assertEqual(spec.mime_types, {"image/jpeg", "image/png", "image/webp", "image/gif"})
        self.assertEqual(spec.max_size_bytes, 10 * 1024 * 1024)
        self.assertTrue(spec.module_gated)


class ThemeSyncTests(TestCase):
    def test_default_theme_synced(self) -> None:
        theme = Theme.objects.get(code="default")
        self.assertEqual(theme.version, "1.0.0")
        self.assertEqual(set(theme.section_types), THEME_V1_SECTION_TYPES)

    def test_theme_sync_updates_changed_schema_without_migration(self) -> None:
        declared = themes.load_code_themes()
        edited = copy.deepcopy(declared)
        edited["default"]["version"] = "1.0.1"
        edited["default"]["section_types"]["hero"]["schema"]["properties"]["heading"][
            "maxLength"
        ] = 99
        with mock.patch.object(themes, "load_code_themes", return_value=edited):
            counts = themes.sync_themes()
        self.assertEqual(counts["updated"], 1)
        theme = Theme.objects.get(code="default")
        self.assertEqual(theme.version, "1.0.1")
        self.assertEqual(
            theme.section_types["hero"]["schema"]["properties"]["heading"]["maxLength"], 99
        )

    def test_theme_sync_is_idempotent(self) -> None:
        self.assertEqual(themes.sync_themes(), {"created": 0, "updated": 0, "stale": 0})

    def test_theme_schemas_use_only_the_supported_subset(self) -> None:
        theme = themes.load_code_themes()["default"]
        for section_type, entry in theme["section_types"].items():
            for path, node in _walk(entry["schema"], section_type):
                self.assertLessEqual(set(node) - SCHEMA_KEYWORDS, set(), path)
                if "x-widget" in node:
                    self.assertIn(node["x-widget"], SCHEMA_WIDGETS, path)
                if "format" in node:
                    self.assertEqual(node["format"], "safe-url", path)
                if "$ref" in node:
                    self.assertEqual(node["$ref"], themes.RICH_TEXT_SCHEMA_REF, path)

    def test_every_image_property_is_a_file_reference(self) -> None:
        theme = themes.load_code_themes()["default"]
        for section_type, entry in theme["section_types"].items():
            for path, node in _walk(entry["schema"], section_type):
                if node.get("x-widget") == "image":
                    self.assertEqual(node["type"], "string", path)
                    self.assertTrue(path.endswith("_file_id"), path)

    def test_rich_text_schema_is_valid_json_schema(self) -> None:
        from jsonschema import Draft202012Validator

        schema = themes.load_rich_text_schema()
        Draft202012Validator.check_schema(schema)
        valid = {"blocks": [{"type": "paragraph", "text": "Hi"}]}
        self.assertTrue(Draft202012Validator(schema).is_valid(valid))
        bad = {"blocks": [{"type": "html", "text": "<script>"}]}
        self.assertFalse(Draft202012Validator(schema).is_valid(bad))

    def test_theme_file_is_plain_json(self) -> None:
        json.loads((themes.THEMES_DIR / "default.json").read_text(encoding="utf-8"))

    def test_section_type_enum_matches_theme(self) -> None:
        # A3's serializer takes its `section_type` choices from SectionType; renderer drift is
        # caught by tsc against the generated `SectionTypeEnum` (decision 6).
        theme = Theme.objects.get(code="default")
        self.assertEqual(set(SectionType.values), set(theme.section_types))


class PageConstraintTests(TestCase):
    def setUp(self) -> None:
        self.tenant = TenantFactory()

    def test_null_locale_slugs_collide_per_tenant(self) -> None:
        with tenant_context(self.tenant.id):
            WebsitePageFactory(tenant=self.tenant, slug="about-us")
            with self.assertRaises(IntegrityError), transaction.atomic():
                WebsitePageFactory(tenant=self.tenant, slug="about-us")

    def test_deleted_slug_can_be_reused(self) -> None:
        from django.utils import timezone

        with tenant_context(self.tenant.id):
            page = WebsitePageFactory(tenant=self.tenant, slug="about-us")
            WebsitePage.objects.filter(pk=page.pk).update(deleted_at=timezone.now())
            WebsitePageFactory(tenant=self.tenant, slug="about-us")

    def test_one_home_page_per_tenant(self) -> None:
        with tenant_context(self.tenant.id):
            WebsitePageFactory(tenant=self.tenant, slug="home", page_type=PageType.HOME)
            with self.assertRaises(IntegrityError), transaction.atomic():
                WebsitePageFactory(tenant=self.tenant, slug="start", page_type=PageType.HOME)
