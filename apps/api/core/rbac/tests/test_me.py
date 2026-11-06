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
