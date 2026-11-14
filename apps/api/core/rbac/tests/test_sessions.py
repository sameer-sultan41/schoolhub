"""``revoke_refresh_tokens`` ends every session, including a rotated refresh token."""

from __future__ import annotations

from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from apps.school_organization.tests.factories import TenantFactory, UserFactory
from core.rbac.sessions import revoke_refresh_tokens
from core.rbac.views import REFRESH_COOKIE_NAME

REFRESH_URL = "/api/v1/auth/refresh"


class RevokeRefreshTokensTests(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        cache.clear()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)

    def refresh(self, raw_token: str):
        self.client.cookies[REFRESH_COOKIE_NAME] = raw_token
        return self.client.post(REFRESH_URL)

    def test_revoke_refresh_tokens_covers_a_rotated_token(self) -> None:
        original = str(RefreshToken.for_user(self.user))
        rotated_response = self.refresh(original)
        self.assertEqual(rotated_response.status_code, status.HTTP_200_OK)
        rotated = rotated_response.cookies[REFRESH_COOKIE_NAME].value
        self.assertNotEqual(rotated, original)

        revoke_refresh_tokens(self.user.id)

        self.assertEqual(self.refresh(rotated).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_revoke_refresh_tokens_leaves_other_users_alone(self) -> None:
        other = UserFactory(tenant=self.tenant)
        others_token = str(RefreshToken.for_user(other))
        RefreshToken.for_user(self.user)

        revoke_refresh_tokens(self.user.id)

        self.assertEqual(self.refresh(others_token).status_code, status.HTTP_200_OK)
