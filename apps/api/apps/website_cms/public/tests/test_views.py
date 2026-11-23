"""The renderer's public content reads: `tenants/by-host`, `site`, `pages` and `sitemap`.

Review Focus 1 (draft or private data leaking), 2 (a host reaching the wrong tenant) and 3 (the
site's own state). Every request carries the machine token unless the test is about auth.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from unittest import mock

from django.core.cache import cache
from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient, APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from apps.school_organization.tests.factories import CampusFactory
from apps.website_cms.constants import (
    EVENTS_PATH_PREFIX,
    GALLERY_PATH_PREFIX,
    HOMEPAGE_SLUG,
    NEWS_PATH_PREFIX,
    RESERVED_PAGE_SLUGS,
)
from apps.website_cms.models import (
    ContentStatus,
    CustomDomainStatus,
    MenuLocation,
    PageType,
    SeoTargetType,
    WebsitePage,
)
from apps.website_cms.preview import PREVIEW_TOKEN_MAX_AGE, make_preview_token
from apps.website_cms.tests.factories import (
    GalleryAlbumFactory,
    NavigationMenuFactory,
    NewsPostFactory,
    PageSectionFactory,
    SchoolEventFactory,
    SeoSettingFactory,
    TenantFactory,
    UserFactory,
    WebsitePageFactory,
    WebsiteSettingsFactory,
    enable_feature,
    make_custom_domain,
)
from core.rbac.machine import PublicPreviewThrottle
from core.tenancy.context import tenant_context
from core.tenancy.models import TenantFeatureOverride, TenantSettings, TenantStatus

TOKEN = "renderer-token"
PLATFORM = "schools.test"
PUBLISHED = ContentStatus.PUBLISHED
ROUTES = ("tenants/by-host", "site", "pages", "sitemap")

TENANT_KEYS = {
    "id",
    "slug",
    "name",
    "status",
    "website_status",
    "branding",
    "locale",
    "contact",
    "custom_domain",
    "enabled_modules",
}
BRANDING_KEYS = {
    "primary_color",
    "secondary_color",
    "accent_color",
    "background_color",
    "foreground_color",
    "heading_font",
    "body_font",
    "logo_url",
    "logo_dark_url",
    "favicon_url",
    "radius",
}
SITE_KEYS = {"theme", "navigation", "header_config", "footer_config", "social_links", "seo"}
SEO_KEYS = {"title", "description", "canonical_url", "og_image_url", "robots", "noindex"}
PAGE_KEYS = {
    "id",
    "slug",
    "path",
    "title",
    "page_type",
    "status",
    "is_homepage",
    "published_at",
    "updated_at",
    "sections",
    "seo",
}


@override_settings(WEBSITE_MACHINE_TOKENS=TOKEN, PLATFORM_DOMAIN=PLATFORM)
class PublicAPITestCase(APITestCase):
    """A live site for `greenfield.schools.test`, read with the renderer's token."""

    def setUp(self) -> None:
        super().setUp()
        cache.clear()
        self.tenant = TenantFactory(slug="greenfield", name="Greenfield School")
        self.host = f"greenfield.{PLATFORM}"
        enable_feature(self.tenant, "module.website")
        self.site = self.make_site(self.tenant, is_published=True)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {TOKEN}")

    def read(self, route: str, host: str | None = None, meta=None, **params):
        query = {"host": self.host if host is None else host, **params}
        return self.client.get(f"/api/v1/public/{route}", query, **(meta or {}))

    def make_site(self, tenant, **kwargs):
        with tenant_context(tenant.id):
            return WebsiteSettingsFactory(tenant=tenant, **kwargs)

    def update_site(self, **fields) -> None:
        with tenant_context(self.tenant.id):
            for name, value in fields.items():
                setattr(self.site, name, value)
            self.site.save()

    def make_page(self, tenant=None, **kwargs):
        tenant = tenant or self.tenant
        with tenant_context(tenant.id):
            return WebsitePageFactory(tenant=tenant, **kwargs)

    def make_home(self, tenant=None, **kwargs):
        kwargs = {"slug": "home", "page_type": PageType.HOME, "status": PUBLISHED, **kwargs}
        return self.make_page(tenant, **kwargs)

    def make_section(self, page, **kwargs):
        with tenant_context(page.tenant_id):
            return PageSectionFactory(tenant=page.tenant, website_page=page, **kwargs)

    def make_in(self, factory_class, tenant=None, **kwargs):
        tenant = tenant or self.tenant
        with tenant_context(tenant.id):
            return factory_class(tenant=tenant, **kwargs)

    def set_branding(self, branding: dict) -> None:
        with tenant_context(self.tenant.id):
            row, _ = TenantSettings.objects.get_or_create(tenant=self.tenant)
            row.branding = branding
            row.save(update_fields=["branding", "updated_at"])

    def give_campus_and_domain(self) -> None:
        with tenant_context(self.tenant.id):
            CampusFactory(
                tenant=self.tenant, is_primary=True, phone="0300 1234567", email="a@school.test"
            )
        make_custom_domain(
            self.tenant, "www.greenfield.org", CustomDomainStatus.ACTIVE, is_primary=True
        )


class TenantByHostTests(PublicAPITestCase):
    def test_by_host_returns_the_tenant(self) -> None:
        self.set_branding({"primary_color": "#0a7"})
        self.give_campus_and_domain()
        self.update_site(default_locale="ur")

        response = self.read("tenants/by-host")

        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(set(data), TENANT_KEYS)
        self.assertEqual(set(data["contact"]), {"campus_name", "address", "phone", "email"})
        self.assertEqual(data["id"], str(self.tenant.id))
        self.assertEqual(data["slug"], "greenfield")
        self.assertEqual(data["name"], "Greenfield School")
        self.assertEqual(data["status"], TenantStatus.ACTIVE)
        self.assertEqual(data["website_status"], "live")
        self.assertEqual(data["branding"], dict.fromkeys(BRANDING_KEYS) | {"primary_color": "#0a7"})
        self.assertEqual(
            data["locale"],
            {
                "default_locale": "ur",
                "enabled_locales": ["ur"],
                "timezone": "UTC",
                "direction": "rtl",
            },
        )
        self.assertEqual(data["contact"]["phone"], "0300 1234567")
        self.assertEqual(data["contact"]["email"], "a@school.test")
        self.assertEqual(data["custom_domain"], "www.greenfield.org")
        self.assertIn("module.website", data["enabled_modules"])
        self.assertTrue(all(key.startswith("module.") for key in data["enabled_modules"]))

    def test_by_host_resolves_an_active_custom_domain(self) -> None:
        make_custom_domain(self.tenant, "www.greenfield.org", CustomDomainStatus.ACTIVE)
        response = self.read("tenants/by-host", host="WWW.Greenfield.org:443")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["id"], str(self.tenant.id))

    def test_by_host_defaults_without_campus_domain_or_settings(self) -> None:
        bare = TenantFactory(slug="bare", locale="en")
        enable_feature(bare, "module.website")
        data = self.read("tenants/by-host", host=f"bare.{PLATFORM}").json()["data"]
        self.assertIsNone(data["contact"])
        self.assertIsNone(data["custom_domain"])
        self.assertEqual(data["website_status"], "unpublished")
        self.assertEqual(data["locale"]["default_locale"], "en")
        self.assertEqual(data["locale"]["direction"], "ltr")

    def assert_notice_only(self, data: dict) -> None:
        """A school not serving a live site: identity, branding and state, nothing else."""
        self.assertEqual(set(data), TENANT_KEYS)
        self.assertIsNone(data["contact"])
        self.assertIsNone(data["custom_domain"])
        self.assertEqual(data["enabled_modules"], [])
        self.assertEqual(data["name"], self.tenant.name)
        self.assertEqual(data["branding"]["primary_color"], "#0a7")

    def test_by_host_reports_suspended_status(self) -> None:
        self.set_branding({"primary_color": "#0a7"})
        self.give_campus_and_domain()
        self.tenant.status = TenantStatus.SUSPENDED
        self.tenant.save(update_fields=["status"])

        response = self.read("tenants/by-host")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["status"], "suspended")
        self.assert_notice_only(response.json()["data"])
        # The suspended school's content is not served.
        self.make_home()
        for route in ("site", "pages", "sitemap"):
            with self.subTest(route=route):
                self.assertEqual(self.read(route).status_code, 404)

    def test_by_host_404_for_deprovisioned_and_provisioning(self) -> None:
        for status in (TenantStatus.DEPROVISIONED, TenantStatus.PROVISIONING):
            with self.subTest(status=status):
                self.tenant.status = status
                self.tenant.save(update_fields=["status"])
                self.assertEqual(self.read("tenants/by-host").status_code, 404)

    def test_by_host_404_for_a_deleted_tenant_and_an_unknown_host(self) -> None:
        self.assertEqual(self.read("tenants/by-host", host=f"nobody.{PLATFORM}").status_code, 404)
        self.assertEqual(self.read("tenants/by-host", host="").status_code, 404)
        self.tenant.deleted_at = self.tenant.created_at
        self.tenant.save(update_fields=["deleted_at"])
        self.assertEqual(self.read("tenants/by-host").status_code, 404)

    def test_by_host_website_status_maintenance(self) -> None:
        self.update_site(maintenance_mode=True)
        self.make_home()

        response = self.read("tenants/by-host")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["website_status"], "maintenance")
        self.assertEqual(self.read("pages", slug="").status_code, 404)

    def test_by_host_reports_unpublished_when_the_module_is_off(self) -> None:
        self.set_branding({"primary_color": "#0a7"})
        self.give_campus_and_domain()
        with tenant_context(self.tenant.id):
            TenantFeatureOverride.objects.filter(
                tenant=self.tenant, feature_flag__key="module.website"
            ).update(enabled=False)
        cache.clear()

        response = self.read("tenants/by-host")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["website_status"], "unpublished")
        self.assert_notice_only(response.json()["data"])

    def test_by_host_withholds_details_while_unpublished_or_in_maintenance(self) -> None:
        self.set_branding({"primary_color": "#0a7"})
        self.give_campus_and_domain()
        for fields in ({"is_published": False}, {"is_published": True, "maintenance_mode": True}):
            with self.subTest(fields=fields):
                self.update_site(**fields)
                self.assert_notice_only(self.read("tenants/by-host").json()["data"])

    def test_branding_keeps_only_the_contract_keys(self) -> None:
        self.set_branding({"primary_color": "#0a7", "notes": "board meeting Tuesday", "x": 1})
        branding = self.read("tenants/by-host").json()["data"]["branding"]
        self.assertEqual(set(branding), BRANDING_KEYS)

    def test_branding_keeps_valid_values(self) -> None:
        valid = {
            "primary_color": "#0a7",
            "secondary_color": "#0a7b3c",
            "accent_color": "#0a7b3cff",
            "background_color": "rgb(255, 255, 255)",
            "foreground_color": "oklch(0.55 0.18 342 / 80%)",
            "heading_font": "'Noto Nastaliq Urdu', serif",
            "body_font": "Inter, system-ui, sans-serif",
            "logo_url": "https://cdn.example.org/logo.png",
            "logo_dark_url": "/media/logo-dark.png",
            "favicon_url": "https://cdn.example.org/favicon.ico",
            "radius": "0.625rem",
        }
        self.set_branding(valid)
        self.assertEqual(self.read("tenants/by-host").json()["data"]["branding"], valid)

    def test_branding_nulls_injection_shaped_values(self) -> None:
        hostile = {
            "primary_color": "red;}body{display:none",
            "secondary_color": "url(https://evil.test/x)",
            "accent_color": "rgb(0,0,0);x:y",
            "background_color": "hsl(var(--x))",
            "foreground_color": "expression(alert(1))",
            "heading_font": "Inter; } * { color: red",
            "body_font": "</style><script>alert(1)</script>",
            "logo_url": "javascript:alert(1)",
            "logo_dark_url": "//evil.test/logo.png",
            "favicon_url": "http://insecure.test/favicon.ico",
            "radius": "1rem;}",
        }
        self.set_branding(hostile)
        branding = self.read("tenants/by-host").json()["data"]["branding"]
        self.assertEqual(branding, dict.fromkeys(BRANDING_KEYS))

    def test_branding_non_string_values_are_null(self) -> None:
        self.set_branding({"primary_color": 7, "logo_url": {"url": "https://x.test"}})
        branding = self.read("tenants/by-host").json()["data"]["branding"]
        self.assertIsNone(branding["primary_color"])
        self.assertIsNone(branding["logo_url"])


class PageTests(PublicAPITestCase):
    def test_homepage_for_empty_slug(self) -> None:
        home = self.make_home(title="Welcome")
        self.make_page(slug="about", status=PUBLISHED)
        for params in ({"slug": ""}, {}, {"slug": "/"}):
            with self.subTest(params=params):
                response = self.read("pages", **params)
                self.assertEqual(response.status_code, 200)
                data = response.json()["data"]
                self.assertEqual(data["id"], str(home.id))
                self.assertEqual(data["path"], "/")
                self.assertTrue(data["is_homepage"])
                self.assertEqual(set(data), PAGE_KEYS)
                self.assertEqual(set(data["seo"]), SEO_KEYS)

    def test_homepage_answers_at_root_only(self) -> None:
        """Its own slug is no second address for it: `home` is reserved, and a renamed one too."""
        self.make_home()
        self.assertEqual(self.read("pages", slug="home").status_code, 404)
        with tenant_context(self.tenant.id):
            WebsitePage.objects.filter(page_type=PageType.HOME).update(slug="welcome")
        self.assertEqual(self.read("pages", slug="welcome").status_code, 404)
        self.assertEqual(self.read("pages", slug="").status_code, 200)
        self.assertIn(HOMEPAGE_SLUG, RESERVED_PAGE_SLUGS)

    def test_page_by_slug(self) -> None:
        page = self.make_page(slug="about/history", title="History", status=PUBLISHED)
        data = self.read("pages", slug="about/history").json()["data"]
        self.assertEqual(data["id"], str(page.id))
        self.assertEqual(data["path"], "/about/history")
        self.assertEqual(data["status"], "published")
        self.assertFalse(data["is_homepage"])

    def test_page_404_when_site_unpublished(self) -> None:
        self.make_home()
        self.update_site(is_published=False)
        self.assertEqual(self.read("pages", slug="").status_code, 404)

    def test_page_404_without_a_settings_row(self) -> None:
        bare = TenantFactory(slug="bare")
        enable_feature(bare, "module.website")
        self.make_home(bare)
        self.assertEqual(self.read("pages", host=f"bare.{PLATFORM}").status_code, 404)

    def test_page_404_when_module_disabled(self) -> None:
        other = TenantFactory(slug="nomodule")
        self.make_site(other, is_published=True)
        self.make_home(other)
        for route in ("site", "pages", "sitemap"):
            with self.subTest(route=route):
                self.assertEqual(self.read(route, host=f"nomodule.{PLATFORM}").status_code, 404)

    def test_draft_page_404_without_preview(self) -> None:
        self.make_page(slug="admissions", status=ContentStatus.DRAFT)
        self.make_page(slug="old", status=ContentStatus.ARCHIVED)
        self.assertEqual(self.read("pages", slug="admissions").status_code, 404)
        self.assertEqual(self.read("pages", slug="old").status_code, 404)

    def test_deleted_page_404(self) -> None:
        page = self.make_page(slug="gone", status=PUBLISHED)
        with tenant_context(self.tenant.id):
            page.deleted_at = page.created_at
            page.save(update_fields=["deleted_at"])
        self.assertEqual(self.read("pages", slug="gone").status_code, 404)

    def test_hidden_sections_omitted(self) -> None:
        page = self.make_page(slug="about", status=PUBLISHED)
        second = self.make_section(page, position=2, content={"heading": "Second"})
        self.make_section(page, position=1, content={"heading": "Hidden"}, is_visible=False)
        first = self.make_section(page, position=0, content={"heading": "First"})

        sections = self.read("pages", slug="about").json()["data"]["sections"]

        self.assertEqual([s["id"] for s in sections], [str(first.id), str(second.id)])
        self.assertEqual(
            sections[0],
            {
                "id": str(first.id),
                "type": "hero",
                "position": 0,
                "props": {"heading": "First"},
            },
        )

    def test_deleted_sections_omitted(self) -> None:
        page = self.make_page(slug="about", status=PUBLISHED)
        section = self.make_section(page, position=0)
        with tenant_context(self.tenant.id):
            section.deleted_at = section.created_at
            section.save(update_fields=["deleted_at"])
        self.assertEqual(self.read("pages", slug="about").json()["data"]["sections"], [])

    def test_section_image_ids_become_public_urls(self) -> None:
        page = self.make_page(slug="about", status=PUBLISHED)
        file_id = "3f1c2b8a-1111-4222-8333-444455556666"
        self.make_section(page, position=0, content={"heading": "Hi", "image_file_id": file_id})

        props = self.read("pages", slug="about").json()["data"]["sections"][0]["props"]

        self.assertNotIn("image_file_id", props)
        self.assertEqual(
            props["image_url"],
            f"https://api.schoolhub.test/api/v1/public/files/{self.tenant.id}/{file_id}",
        )

    def test_section_of_a_type_the_theme_lacks_is_skipped(self) -> None:
        page = self.make_page(slug="about", status=PUBLISHED)
        self.make_section(page, position=0, section_type="retired_widget", content={})
        self.assertEqual(self.read("pages", slug="about").json()["data"]["sections"], [])

    def test_page_seo(self) -> None:
        page = self.make_page(slug="about", status=PUBLISHED, show_in_search=False)
        self.make_in(
            SeoSettingFactory,
            target_type=SeoTargetType.PAGE,
            target_id=page.id,
            meta_title="About Greenfield",
            meta_description="",
            og_image_file_id="3f1c2b8a-1111-4222-8333-444455556666",
        )
        seo = self.read("pages", slug="about").json()["data"]["seo"]
        self.assertEqual(seo["title"], "About Greenfield")
        self.assertIsNone(seo["description"])
        self.assertTrue(seo["og_image_url"].endswith("/3f1c2b8a-1111-4222-8333-444455556666"))
        self.assertTrue(seo["noindex"])

    def test_page_queries_do_not_grow_with_sections(self) -> None:
        small = self.make_page(slug="small", status=PUBLISHED)
        large = self.make_page(slug="large", status=PUBLISHED)
        self.make_section(small, position=0)
        for position in range(6):
            self.make_section(large, position=position)
        self.read("pages", slug="small")  # warm the feature-flag cache

        counts = []
        for slug in ("small", "large"):
            with CaptureQueriesContext(connection) as queries:
                self.assertEqual(self.read("pages", slug=slug).status_code, 200)
            counts.append(len(queries))
        self.assertEqual(counts[0], counts[1])


class PreviewTests(PublicAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.draft = self.make_page(slug="admissions", status=ContentStatus.DRAFT)
        self.make_section(self.draft, position=0, content={"heading": "Apply now"})

    def preview(self, token: str, slug: str | None = "admissions", **params):
        if slug is not None:
            params["slug"] = slug
        return self.read("pages", meta={"HTTP_X_PREVIEW_TOKEN": token}, **params)

    def test_preview_token_reads_the_draft_uncached(self) -> None:
        response = self.preview(make_preview_token(self.draft))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["status"], "draft")
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertIn("X-Preview-Token", response["Vary"])

    def test_preview_response_carries_the_tokens_expiry(self) -> None:
        signed_at = int(time.time()) - 100
        with mock.patch("django.core.signing.time.time", return_value=signed_at):
            token = make_preview_token(self.draft)
        expected = (
            (datetime.fromtimestamp(signed_at, tz=UTC) + timedelta(seconds=PREVIEW_TOKEN_MAX_AGE))
            .isoformat()
            .replace("+00:00", "Z")
        )
        for resource, params in (("pages", {"slug": "admissions"}), ("site", {})):
            with self.subTest(resource=resource):
                response = self.read(resource, meta={"HTTP_X_PREVIEW_TOKEN": token}, **params)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response["X-Preview-Expires-At"], expected)

    def test_published_read_without_a_token_has_no_expiry_header(self) -> None:
        self.make_page(slug="about", status=PUBLISHED)
        response = self.read("pages", slug="about")
        self.assertNotIn("X-Preview-Expires-At", response)

    def test_published_page_varies_on_the_preview_header_but_is_cacheable(self) -> None:
        self.make_page(slug="about", status=PUBLISHED)
        response = self.read("pages", slug="about")
        self.assertIn("X-Preview-Token", response["Vary"])
        self.assertNotIn("no-store", response.get("Cache-Control", ""))

    def test_preview_without_a_slug_reads_the_tokens_page(self) -> None:
        """The renderer validates a token before it knows the page's address."""
        data = self.preview(make_preview_token(self.draft), slug=None).json()["data"]
        self.assertEqual(data["id"], str(self.draft.id))
        self.assertEqual(data["path"], "/admissions")

    def test_preview_of_the_homepage(self) -> None:
        home = self.make_home(status=ContentStatus.DRAFT)
        token = make_preview_token(home)
        for slug in ("", None):
            with self.subTest(slug=slug):
                data = self.preview(token, slug=slug).json()["data"]
                self.assertEqual(data["id"], str(home.id))
                self.assertEqual(data["path"], "/")

    def test_preview_works_before_the_site_is_published(self) -> None:
        self.update_site(is_published=False)
        self.assertEqual(self.preview(make_preview_token(self.draft)).status_code, 200)

    def test_preview_still_needs_the_module_and_an_operational_tenant(self) -> None:
        token = make_preview_token(self.draft)
        self.tenant.status = TenantStatus.SUSPENDED
        self.tenant.save(update_fields=["status"])
        self.assertEqual(self.preview(token).status_code, 404)

    def test_preview_token_for_other_page_404(self) -> None:
        other = self.make_page(slug="fees", status=ContentStatus.DRAFT)
        published = self.make_page(slug="about", status=PUBLISHED)
        token = make_preview_token(other)
        self.assertEqual(self.preview(token).status_code, 404)
        # Nor does it open a published page it does not name.
        self.assertEqual(self.preview(token, slug="about").status_code, 404)
        self.assertEqual(self.read("pages", slug="about").json()["data"]["id"], str(published.id))

    def test_preview_token_for_other_tenant_404(self) -> None:
        rival = TenantFactory(slug="rival")
        enable_feature(rival, "module.website")
        self.make_site(rival, is_published=True)
        rival_page = self.make_page(rival, slug="admissions", status=ContentStatus.DRAFT)
        # The rival's own token, presented on this tenant's host.
        self.assertEqual(self.preview(make_preview_token(rival_page)).status_code, 404)

    def test_expired_preview_token_404(self) -> None:
        token = make_preview_token(self.draft)
        later = time.time() + PREVIEW_TOKEN_MAX_AGE + 5
        with mock.patch("django.core.signing.time.time", return_value=later):
            self.assertEqual(self.preview(token).status_code, 404)

    def test_tampered_token_404_even_on_a_published_page(self) -> None:
        self.make_page(slug="about", status=PUBLISHED)
        self.assertEqual(self.preview("not-a-token", slug="about").status_code, 404)

    def test_preview_token_in_query_string_ignored(self) -> None:
        token = make_preview_token(self.draft)
        for name in ("preview", "token", "preview_token", "X-Preview-Token"):
            with self.subTest(name=name):
                response = self.read("pages", slug="admissions", **{name: token})
                self.assertEqual(response.status_code, 404)

    def test_hidden_sections_omitted_in_preview(self) -> None:
        self.make_section(self.draft, position=1, is_visible=False)
        sections = self.preview(make_preview_token(self.draft)).json()["data"]["sections"]
        self.assertEqual(len(sections), 1)


class PreviewThrottleTests(PublicAPITestCase):
    """Preview reads have their own per-(client, host) bucket (`public_preview`), used instead of
    `machine_client`, so forged preview cookies can cost one school its previews only."""

    def setUp(self) -> None:
        super().setUp()
        self.draft = self.make_page(slug="admissions", status=ContentStatus.DRAFT)
        self.make_section(self.draft, position=0, content={"heading": "Apply now"})
        self.rates = PublicPreviewThrottle.THROTTLE_RATES
        patcher = mock.patch.dict(self.rates, {"public_preview": "2/min"})
        patcher.start()
        self.addCleanup(patcher.stop)

    def preview(self, route: str = "pages", token: str | None = None, host: str | None = None):
        # A junk token unless one is given: it still counts against the bucket.
        header = token if token is not None else "not-a-token"
        return self.read(route, host=host, meta={"HTTP_X_PREVIEW_TOKEN": header})

    def test_preview_reads_are_throttled_per_school(self) -> None:
        token = make_preview_token(self.draft)
        statuses = [self.preview(token=token).status_code for _ in range(3)]

        self.assertEqual(statuses, [200, 200, 429])

    def test_bad_tokens_count_too_on_pages_and_site(self) -> None:
        statuses = [self.preview(route).status_code for route in ("pages", "site", "pages")]

        self.assertEqual(statuses, [404, 404, 429])

    def test_another_school_has_its_own_bucket(self) -> None:
        rival = TenantFactory(slug="rival")
        enable_feature(rival, "module.website")
        self.make_site(rival, is_published=True)
        for _ in range(3):
            self.preview()

        self.assertEqual(self.preview("site", host=f"rival.{PLATFORM}").status_code, 404)

    def test_preview_reads_never_spend_the_schools_machine_quota(self) -> None:
        with mock.patch.dict(self.rates, {"machine_client": "1/min"}):
            for _ in range(3):
                self.preview()

            # The school's first plain read is still let through.
            self.assertEqual(self.read("site").status_code, 200)

    def test_reads_without_the_header_are_not_counted(self) -> None:
        for _ in range(3):
            self.preview()

        self.assertNotEqual(self.read("pages").status_code, 429)
        self.assertNotEqual(self.read("site").status_code, 429)


class SiteTests(PublicAPITestCase):
    def preview_site(self, token: str):
        return self.read("site", meta={"HTTP_X_PREVIEW_TOKEN": token})

    def test_site_preview_before_the_site_is_published(self) -> None:
        self.update_site(is_published=False)
        draft = self.make_page(slug="admissions", status=ContentStatus.DRAFT)

        response = self.preview_site(make_preview_token(draft))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertIn("X-Preview-Token", response["Vary"])
        self.assertEqual(self.read("site").status_code, 404)

    def test_site_preview_with_another_tenants_token_404(self) -> None:
        self.update_site(is_published=False)
        rival = TenantFactory(slug="rival")
        rival_page = self.make_page(rival, slug="admissions", status=ContentStatus.DRAFT)
        self.assertEqual(self.preview_site(make_preview_token(rival_page)).status_code, 404)

    def test_site_preview_with_a_bad_token_404_even_when_live(self) -> None:
        self.assertEqual(self.preview_site("not-a-token").status_code, 404)

    def test_site_navigation_drops_unpublished_targets(self) -> None:
        home = self.make_home()
        about = self.make_page(slug="about", status=PUBLISHED)
        draft = self.make_page(slug="secret", status=ContentStatus.DRAFT)
        archived = self.make_page(slug="old", status=ContentStatus.ARCHIVED)
        self.make_in(
            NavigationMenuFactory,
            location=MenuLocation.HEADER,
            items=[
                {"label": "Home", "target_type": "page", "target": str(home.id), "children": []},
                {
                    "label": "About",
                    "target_type": "page",
                    "target": str(about.id),
                    "children": [
                        {"label": "Secret", "target_type": "page", "target": str(draft.id)},
                        {"label": "Blog", "target_type": "url", "target": "https://blog.test"},
                    ],
                },
                {"label": "Old", "target_type": "page", "target": str(archived.id)},
                {"label": "News", "target_type": "news_index", "children": []},
            ],
        )
        self.make_in(
            NavigationMenuFactory,
            location=MenuLocation.FOOTER_PRIMARY,
            items=[{"label": "Events", "target_type": "events_index", "children": []}],
        )

        navigation = self.read("site").json()["data"]["navigation"]

        self.assertEqual(
            navigation["header"],
            [
                {"label": "Home", "href": "/", "children": []},
                {
                    "label": "About",
                    "href": "/about",
                    "children": [{"label": "Blog", "href": "https://blog.test"}],
                },
                {"label": "News", "href": f"/{NEWS_PATH_PREFIX}", "children": []},
            ],
        )
        self.assertEqual(
            navigation["footer_primary"],
            [{"label": "Events", "href": f"/{EVENTS_PATH_PREFIX}", "children": []}],
        )
        self.assertEqual(navigation["footer_secondary"], [])

    def test_site_shape(self) -> None:
        self.update_site(
            social_links=[{"platform": "facebook", "url": "https://facebook.com/greenfield"}],
            header_config={"cta": {"label": "Apply", "href": "/admissions"}},
            analytics_id="G-INTERNAL",
        )
        self.make_in(
            SeoSettingFactory,
            target_type=SeoTargetType.SITE,
            meta_title="Greenfield",
            og_image_file_id="3f1c2b8a-1111-4222-8333-444455556666",
            structured_data={"@type": "School"},
        )

        data = self.read("site").json()["data"]

        self.assertEqual(set(data), SITE_KEYS)
        self.assertEqual(set(data["theme"]), {"code", "version", "config"})
        self.assertEqual(set(data["navigation"]), {"header", "footer_primary", "footer_secondary"})
        self.assertEqual(set(data["seo"]), SEO_KEYS)
        self.assertNotIn("G-INTERNAL", str(data))

        self.assertEqual(data["theme"]["code"], "default")
        self.assertEqual(data["theme"]["version"], self.site.theme.version)
        self.assertEqual(
            data["social_links"],
            [{"platform": "facebook", "url": "https://facebook.com/greenfield"}],
        )
        self.assertEqual(data["header_config"], {"cta": {"label": "Apply", "href": "/admissions"}})
        self.assertEqual(data["seo"]["title"], "Greenfield")
        self.assertEqual(
            data["seo"]["og_image_url"],
            f"https://api.schoolhub.test/api/v1/public/files/{self.tenant.id}/"
            "3f1c2b8a-1111-4222-8333-444455556666",
        )
        self.assertFalse(data["seo"]["noindex"])

    def test_site_404_when_unpublished_or_in_maintenance(self) -> None:
        for fields in ({"is_published": False}, {"is_published": True, "maintenance_mode": True}):
            with self.subTest(fields=fields):
                self.update_site(**fields)
                self.assertEqual(self.read("site").status_code, 404)

    def test_site_queries_do_not_grow_with_menu_targets(self) -> None:
        pages = [self.make_page(slug=f"p{n}", status=PUBLISHED) for n in range(6)]
        menu = self.make_in(NavigationMenuFactory, location=MenuLocation.HEADER, items=[])
        self.read("site")  # warm the feature-flag cache

        counts = []
        for size in (1, 6):
            with tenant_context(self.tenant.id):
                menu.items = [
                    {"label": p.slug, "target_type": "page", "target": str(p.id), "children": []}
                    for p in pages[:size]
                ]
                menu.save(update_fields=["items"])
            with CaptureQueriesContext(connection) as queries:
                response = self.read("site")
            self.assertEqual(len(response.json()["data"]["navigation"]["header"]), size)
            counts.append(len(queries))
        self.assertEqual(counts[0], counts[1])


class SitemapTests(PublicAPITestCase):
    def test_sitemap_excludes_show_in_search_false(self) -> None:
        self.make_home()
        self.make_page(slug="about", status=PUBLISHED)
        self.make_page(slug="thanks", status=PUBLISHED, show_in_search=False)
        self.make_page(slug="draft", status=ContentStatus.DRAFT)
        self.make_in(NewsPostFactory, slug="sports-day", status=PUBLISHED)
        self.make_in(NewsPostFactory, slug="unpublished-news", status=ContentStatus.DRAFT)
        self.make_in(SchoolEventFactory, slug="open-day", status=PUBLISHED)
        self.make_in(SchoolEventFactory, slug="old-event", status=ContentStatus.ARCHIVED)
        self.make_in(GalleryAlbumFactory, slug="prize-giving", status=PUBLISHED)
        self.make_in(GalleryAlbumFactory, slug="private-album", status=ContentStatus.DRAFT)

        response = self.read("sitemap")

        self.assertEqual(response.status_code, 200)
        entries = response.json()["data"]
        self.assertIsInstance(entries, list)
        self.assertEqual(
            [entry["path"] for entry in entries],
            [
                "/about",
                "/",
                f"/{NEWS_PATH_PREFIX}/sports-day",
                f"/{EVENTS_PATH_PREFIX}/open-day",
                f"/{GALLERY_PATH_PREFIX}/prize-giving",
            ],
        )
        self.assertTrue(all(entry["updated_at"] for entry in entries))
        self.assertTrue(all(set(entry) == {"path", "updated_at"} for entry in entries))
        # A bare list in the envelope: no pagination keys beside the request id.
        self.assertEqual(set(response.json()), {"data", "meta"})
        self.assertEqual(set(response.json()["meta"]), {"request_id"})

    def test_sitemap_excludes_robots_noindex(self) -> None:
        """One rule (`is_indexable`) decides the sitemap and a page's own `seo.noindex`."""
        hidden = self.make_page(slug="private", status=PUBLISHED)
        self.make_page(slug="about", status=PUBLISHED)
        post = self.make_in(NewsPostFactory, slug="internal-note", status=PUBLISHED)
        self.make_in(
            SeoSettingFactory, target_type=SeoTargetType.PAGE, target_id=hidden.id, robots="NoIndex"
        )
        self.make_in(
            SeoSettingFactory,
            target_type=SeoTargetType.NEWS_POST,
            target_id=post.id,
            robots="noindex, follow",
        )

        paths = [entry["path"] for entry in self.read("sitemap").json()["data"]]

        self.assertEqual(paths, ["/about"])
        self.assertTrue(self.read("pages", slug="private").json()["data"]["seo"]["noindex"])

    def test_sitemap_queries_do_not_grow_with_content(self) -> None:
        self.read("sitemap")  # warm the feature-flag cache
        counts = []
        for _ in range(2):
            with CaptureQueriesContext(connection) as queries:
                self.read("sitemap")
            counts.append(len(queries))
            for n in range(5):
                self.make_in(NewsPostFactory, status=PUBLISHED, slug=f"post-{len(counts)}-{n}")
        self.assertEqual(counts[0], counts[1])

    def test_content_prefixes_are_reserved_page_slugs(self) -> None:
        """A page slugged `news` would shadow the renderer's news route."""
        for prefix in (NEWS_PATH_PREFIX, EVENTS_PATH_PREFIX, GALLERY_PATH_PREFIX):
            self.assertIn(prefix, RESERVED_PAGE_SLUGS)


class WrongHostTests(PublicAPITestCase):
    def test_wrong_host_never_returns_other_tenant_content(self) -> None:
        rival = TenantFactory(slug="rival")
        enable_feature(rival, "module.website")
        self.make_site(rival, is_published=True)
        mine = self.make_page(slug="about", title="Ours", status=PUBLISHED)
        theirs = self.make_page(rival, slug="about", title="Theirs", status=PUBLISHED)
        self.make_page(rival, slug="rival-only", status=PUBLISHED)
        # The rival claims a domain it has not proven; only its active domain resolves.
        make_custom_domain(rival, "rival.example", CustomDomainStatus.PENDING_DNS)
        make_custom_domain(self.tenant, "greenfield.example", CustomDomainStatus.ACTIVE)

        for host, expected in (
            (self.host, mine),
            ("greenfield.example", mine),
            (f"rival.{PLATFORM}", theirs),
        ):
            with self.subTest(host=host):
                data = self.read("pages", host=host, slug="about").json()["data"]
                self.assertEqual(data["id"], str(expected.id))
        self.assertEqual(self.read("pages", slug="rival-only").status_code, 404)
        sitemap = [entry["path"] for entry in self.read("sitemap").json()["data"]]
        self.assertNotIn("/rival-only", sitemap)
        for host in (
            "rival.example",
            f"www.greenfield.{PLATFORM}",
            f"nobody.{PLATFORM}",
            PLATFORM,
            "",
        ):
            for route in ROUTES:
                with self.subTest(host=host, route=route):
                    self.assertEqual(self.read(route, host=host).status_code, 404)

    def test_tenant_id_parameter_is_ignored(self) -> None:
        rival = TenantFactory(slug="rival")
        enable_feature(rival, "module.website")
        self.make_site(rival, is_published=True)
        mine = self.make_page(slug="about", status=PUBLISHED)
        self.make_page(rival, slug="about", status=PUBLISHED)
        data = self.read("pages", slug="about", tenant_id=str(rival.id)).json()["data"]
        self.assertEqual(data["id"], str(mine.id))


@override_settings(WEBSITE_MACHINE_TOKENS=TOKEN, PLATFORM_DOMAIN=PLATFORM)
class PublicBoundaryTests(APITestCase):
    """Review Focus 1 and L63 on the real routes: neither credential crosses over."""

    def setUp(self) -> None:
        super().setUp()
        cache.clear()
        self.tenant = TenantFactory(slug="greenfield")
        enable_feature(self.tenant, "module.website")
        with tenant_context(self.tenant.id):
            WebsiteSettingsFactory(tenant=self.tenant, is_published=True)
            WebsitePageFactory(
                tenant=self.tenant, slug="home", page_type=PageType.HOME, status=PUBLISHED
            )

    def get(self, client: APIClient, route: str):
        return client.get(f"/api/v1/public/{route}", {"host": f"greenfield.{PLATFORM}"})

    def test_staff_jwt_rejected_on_public_routes(self) -> None:
        user = UserFactory(tenant=self.tenant)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")
        for route in ROUTES:
            with self.subTest(route=route):
                self.assertEqual(self.get(client, route).status_code, 401)

    def test_missing_or_wrong_token_401(self) -> None:
        wrong = APIClient()
        wrong.credentials(HTTP_AUTHORIZATION="Bearer not-the-token")
        for client in (APIClient(), wrong):
            for route in ROUTES:
                with self.subTest(route=route):
                    self.assertEqual(self.get(client, route).status_code, 401)

    def test_machine_token_rejected_on_cms_routes(self) -> None:
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {TOKEN}")
        for url in ("/api/v1/website-pages", "/api/v1/website-settings", "/api/v1/news-posts"):
            with self.subTest(url=url):
                self.assertEqual(client.get(url).status_code, 401)

    def test_public_routes_take_no_writes(self) -> None:
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {TOKEN}")
        for route in ROUTES:
            with self.subTest(route=route):
                response = client.post(f"/api/v1/public/{route}?host=greenfield.{PLATFORM}", {})
                self.assertEqual(response.status_code, 405)
