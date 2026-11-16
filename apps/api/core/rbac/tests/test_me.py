"""`GET /auth/me` tells a client whether the caller is a student or guardian."""

from __future__ import annotations

from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import TenantFactory, UserFactory, authenticate, grant


class MeRestrictedPrincipalTests(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)

    def me(self) -> dict:
        authenticate(self.client, self.user)
        response = self.client.get("/api/v1/auth/me")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        return response.data["data"]

    def test_me_flags_restricted_principal(self) -> None:
        grant(self.user, "communication.thread.view", is_restricted_principal=True)

        self.assertIs(self.me()["is_restricted_principal"], True)

    def test_me_flag_false_for_staff(self) -> None:
        grant(self.user, "communication.thread.close")

        self.assertIs(self.me()["is_restricted_principal"], False)


class MeTenantSummaryTests(APITestCase):
    def test_me_has_tenant_summary_and_tenant_uuid_unchanged(self) -> None:
        tenant = TenantFactory(name="City School", slug="city-school")
        user = UserFactory(tenant=tenant)
        authenticate(self.client, user)

        response = self.client.get("/api/v1/auth/me")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        body = response.json()["data"]
        # `tenant` stays the UUID clients already read; the summary is a separate field.
        self.assertEqual(body["tenant"], str(tenant.pk))
        self.assertEqual(body["tenant_summary"], {"name": "City School", "slug": "city-school"})

    def test_me_tenant_summary_is_null_for_a_platform_user(self) -> None:
        user = UserFactory(tenant=None, is_platform=True)
        authenticate(self.client, user)

        response = self.client.get("/api/v1/auth/me")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        body = response.json()["data"]
        self.assertIsNone(body["tenant"])
        self.assertIsNone(body["tenant_summary"])
