"""Shared setup for the website module tests."""

from __future__ import annotations

from rest_framework.test import APITestCase

from apps.website_cms.tests.factories import (
    TenantFactory,
    UserFactory,
    authenticate,
    enable_feature,
    grant,
)


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
