"""The renderer's public content reads: `tenants/by-host`, `site`, `pages` and `sitemap`.

Review Focus 1 (draft or private data leaking), 2 (a host reaching the wrong tenant) and 3 (the
site's own state). Every request carries the machine token unless the test is about auth.
"""

from __future__ import annotations

import time
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
    NEWS_PATH_PREFIX,
    RESERVED_PAGE_SLUGS,
)
from apps.website_cms.models import (
    ContentStatus,
    CustomDomainStatus,
    MenuLocation,
    PageType,
    SeoTargetType,
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
from core.tenancy.context import tenant_context
from core.tenancy.models import TenantSettings, TenantStatus

TOKEN = "renderer-token"
PLATFORM = "schools.test"
PUBLISHED = ContentStatus.PUBLISHED
ROUTES = ("tenants/by-host", "site", "pages", "sitemap")


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


class TenantByHostTests(PublicAPITestCase):
    def test_by_host_returns_the_tenant(self) -> None:
        with tenant_context(self.tenant.id):
            row, _ = TenantSettings.objects.get_or_create(tenant=self.tenant)
            row.branding = {"primary_color": "#0a7"}
            row.save(update_fields=["branding", "updated_at"])
            CampusFactory(
                tenant=self.tenant, is_primary=True, phone="0300 1234567", email="a@school.test"
            )
        make_custom_domain(
            self.tenant, "www.greenfield.org", CustomDomainStatus.ACTIVE, is_primary=True
        )
        self.update_site(default_locale="ur")

        response = self.read("tenants/by-host")

        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["id"], str(self.tenant.id))
        self.assertEqual(data["slug"], "greenfield")
        self.assertEqual(data["name"], "Greenfield School")
        self.assertEqual(data["status"], TenantStatus.ACTIVE)
        self.assertEqual(data["website_status"], "live")
        self.assertEqual(data["branding"], {"primary_color": "#0a7"})
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

    def test_by_host_reports_suspended_status(self) -> None:
        self.tenant.status = TenantStatus.SUSPENDED
        self.tenant.save(update_fields=["status"])

        response = self.read("tenants/by-host")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["status"], "suspended")
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
        other = TenantFactory(slug="nomodule")
        self.make_site(other, is_published=True)
        response = self.read("tenants/by-host", host=f"nomodule.{PLATFORM}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["website_status"], "unpublished")
        self.assertNotIn("module.website", response.json()["data"]["enabled_modules"])


class PageTests(PublicAPITestCase):
    def test_homepage_for_empty_slug(self) -> None:
        home = self.make_home(title="Welcome")
        self.make_page(slug="about", status=PUBLISHED)
        for params in ({"slug": ""}, {"slug": "home"}, {}, {"slug": "/"}):
            with self.subTest(params=params):
                response = self.read("pages", **params)
                self.assertEqual(response.status_code, 200)
                data = response.json()["data"]
                self.assertEqual(data["id"], str(home.id))
                self.assertEqual(data["path"], "/")
                self.assertTrue(data["is_homepage"])

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

    def preview(self, token: str, slug: str = "admissions", **params):
        return self.read("pages", meta={"HTTP_X_PREVIEW_TOKEN": token}, slug=slug, **params)

    def test_preview_token_reads_the_draft_uncached(self) -> None:
        response = self.preview(make_preview_token(self.draft))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["status"], "draft")
        self.assertEqual(response["Cache-Control"], "no-store")

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


class SiteTests(PublicAPITestCase):
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
        )
        self.make_in(
            SeoSettingFactory,
            target_type=SeoTargetType.SITE,
            meta_title="Greenfield",
            og_image_file_id="3f1c2b8a-1111-4222-8333-444455556666",
        )

        data = self.read("site").json()["data"]

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
        self.assertNotIn("meta", response.json())

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
