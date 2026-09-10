"""Shared base fixtures for school-organization tests."""

from __future__ import annotations

from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import TenantFactory, UserFactory, authenticate, grant


class SchoolOrganizationAPITestCase(APITestCase):
    """Base fixture: one tenant, one authenticated staff user, no permissions yet."""

    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)

    def allow(self, *permission_keys: str) -> None:
        grant(self.user, *permission_keys)


class TenantFixtureMixin:
    """Base fixture for non-API (model/service-level) tests: one tenant, no client."""

    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
