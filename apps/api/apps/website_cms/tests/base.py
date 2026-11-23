"""Shared setup for the website module tests."""

from __future__ import annotations

from rest_framework.test import APIClient, APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from apps.website_cms.tests.factories import (
    ContactSubmissionFactory,
    GalleryAlbumFactory,
    GalleryItemFactory,
    NewsPostFactory,
    PageSectionFactory,
    SchoolEventFactory,
    TenantFactory,
    UserFactory,
    WebsitePageFactory,
    WebsiteSettingsFactory,
    authenticate,
    enable_feature,
    grant,
)
from core.tenancy.context import tenant_context


class WebsiteAPITestCase(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)
        enable_feature(self.tenant, "module.website")

    def allow(self, *keys: str) -> None:
        grant(self.user, *keys)

    def allow_everything(self) -> None:
        """Every key this module declares, so a denial can only come from tenancy."""
        from core.rbac.registry import registry

        self.allow(*(spec.key for spec in registry.for_module("website")))

    def bearer_client(self, user=None) -> APIClient:
        """A client with `user`'s (default: `self.user`) access token and no session (L63)."""
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user or self.user)}")
        return client

    def assert_ties_page_apart(self, url: str, model, rows, params=None, **tie) -> None:
        """Rows equal on every sort key still list once each, in id order, at `page_size=1`.

        `tie` is written over the rows to make them equal; the pages must then split on `id`.
        """
        with tenant_context(self.tenant.id):
            model.objects.filter(pk__in=[row.pk for row in rows]).update(**tie)
        seen = []
        for page in range(1, len(rows) + 1):
            response = self.client.get(url, {**(params or {}), "page_size": 1, "page": page})
            self.assertEqual(response.status_code, 200, response.content)
            seen.append(response.json()["data"][0]["id"])
        self.assertEqual(seen, sorted(str(row.pk) for row in rows))

    def make_staff(self, slug: str):
        """A user of the tenant holding the default role `slug`."""
        from apps.school_organization.tests.factories import grant_default_role

        user = UserFactory(tenant=self.tenant)
        grant_default_role(user, slug)
        return user

    def make_page(self, tenant=None, **kwargs):
        tenant = tenant or self.tenant
        with tenant_context(tenant.id):
            return WebsitePageFactory(tenant=tenant, **kwargs)

    def make_section(self, page, **kwargs):
        with tenant_context(page.tenant_id):
            return PageSectionFactory(tenant=page.tenant, website_page=page, **kwargs)

    def make_other_tenant(self):
        return TenantFactory()

    def make_news(self, tenant=None, **kwargs):
        tenant = tenant or self.tenant
        with tenant_context(tenant.id):
            return NewsPostFactory(tenant=tenant, **kwargs)

    def make_event(self, tenant=None, **kwargs):
        tenant = tenant or self.tenant
        with tenant_context(tenant.id):
            return SchoolEventFactory(tenant=tenant, **kwargs)

    def make_album(self, tenant=None, **kwargs):
        tenant = tenant or self.tenant
        with tenant_context(tenant.id):
            return GalleryAlbumFactory(tenant=tenant, **kwargs)

    def make_item(self, album, **kwargs):
        with tenant_context(album.tenant_id):
            return GalleryItemFactory(tenant=album.tenant, gallery_album=album, **kwargs)

    def make_contact(self, tenant=None, **kwargs):
        tenant = tenant or self.tenant
        with tenant_context(tenant.id):
            return ContactSubmissionFactory(tenant=tenant, **kwargs)

    def make_media(self, tenant=None):
        """A ready `website.media` file of the tenant."""
        from apps.website_cms.uploads import WEBSITE_MEDIA
        from core.files.tests.factories import FileFactory

        tenant = tenant or self.tenant
        with tenant_context(tenant.id):
            return FileFactory(tenant=tenant, purpose=WEBSITE_MEDIA.key)

    def file_visibility(self, file) -> str:
        from core.files.models import File

        with tenant_context(self.tenant.id):
            return File.objects.get(id=file.id).visibility

    def make_settings(self, tenant=None, **kwargs):
        tenant = tenant or self.tenant
        with tenant_context(tenant.id):
            return WebsiteSettingsFactory(tenant=tenant, **kwargs)

    def sign_in_reader(self):
        """Switch the client to a user holding only `website.page.view`."""
        reader = UserFactory(tenant=self.tenant)
        grant(reader, "website.page.view")
        authenticate(self.client, reader)
        return reader
