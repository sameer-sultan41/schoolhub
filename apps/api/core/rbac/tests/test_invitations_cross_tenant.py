"""Another school's invitation token is refused, never resolved (ADR-0033).

The accept and preview endpoints are unauthenticated, so "cross-tenant" here means a body
naming one school with a token minted at another. The invitation lookup runs inside the
named school's tenant context, where RLS hides the other school's row: the answer is the
same 400 ``invalid_link`` as any unknown token, which confirms nothing.
"""

from __future__ import annotations

from django.core.cache import cache
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import TenantFactory
from core.rbac.tests.link_helpers import (
    LINK_SETTINGS,
    invite,
    invited_user,
    without_app_eligibility_hooks,
)

PREVIEW_URL = "/api/v1/auth/invitations:preview"
ACCEPT_URL = "/api/v1/auth/invitations:accept"
PASSWORD = "test-password-accept-12345"


@override_settings(**LINK_SETTINGS)
class InvitationCrossTenantTests(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        cache.clear()
        self.school_a = TenantFactory()
        self.school_b = TenantFactory()
        self.user_b = invited_user(self.school_b, email="b-invitee@example.test")
        without_app_eligibility_hooks(self)

    def test_other_tenants_token_is_400(self) -> None:
        _, token_b = invite(self, self.user_b)

        for url, body in (
            (PREVIEW_URL, {"school": self.school_a.slug, "token": token_b}),
            (ACCEPT_URL, {"school": self.school_a.slug, "token": token_b, "password": PASSWORD}),
        ):
            with self.subTest(url=url):
                response = self.client.post(url, body, format="json")
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
                self.assertEqual(response.data["error"]["code"], "invalid_link")

        self.user_b.refresh_from_db()
        self.assertFalse(self.user_b.is_active)
        # The token itself was good: at its own school it still works.
        response = self.client.post(
            ACCEPT_URL,
            {"school": self.school_b.slug, "token": token_b, "password": PASSWORD},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT, response.data)
