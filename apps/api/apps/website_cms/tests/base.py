"""Shared setup for the website module tests."""

from __future__ import annotations

from rest_framework.test import APITestCase

from apps.website_cms.tests.factories import (
    PageSectionFactory,
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

    def make_page(self, tenant=None, **kwargs):
        tenant = tenant or self.tenant
        with tenant_context(tenant.id):
            return WebsitePageFactory(tenant=tenant, **kwargs)

    def make_section(self, page, **kwargs):
        with tenant_context(page.tenant_id):
            return PageSectionFactory(tenant=page.tenant, website_page=page, **kwargs)

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
