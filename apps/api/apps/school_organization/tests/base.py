"""Shared base fixtures for school-organization tests."""

from __future__ import annotations

from rest_framework import status
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

    def _ids(self, url: str) -> list[str]:
        """GET ``url`` and return the row ids in response order — the shared
        assertion every `?ordering=` test in this module's packages builds on.
        """
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return [row["id"] for row in response.json()["data"]]


class TenantFixtureMixin:
    """Base fixture for non-API (model/service-level) tests: one tenant, no client."""

    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
