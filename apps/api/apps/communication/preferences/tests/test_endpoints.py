"""`/notification-preferences` — HTTP endpoint round trips."""

from __future__ import annotations

from rest_framework import status

from apps.communication.tests.base import CommunicationAPITestCase
from core.notifications.models import NotificationCategory, NotificationChannel


class PreferenceEndpointTests(CommunicationAPITestCase):
    def test_get_works_with_jwt_only_no_session(self) -> None:
        """The specific gap `force_login` hides — see `preferences/view.py`'s
        mixin note.

        `authenticate()` (used by every other test here) calls both
        `force_login` and sets a bearer token; session auth alone binds
        `request.tenant` via `TenantMiddleware`, which would mask a view that
        forgot `TenantScopedViewSetMixin`. This client carries the bearer
        token only, matching what a real client sends.
        """
        from rest_framework.test import APIClient
        from rest_framework_simplejwt.tokens import AccessToken

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(self.user)}")

        response = client.get("/api/v1/notification-preferences")

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_get_returns_the_full_materialized_matrix(self) -> None:
        response = self.client.get("/api/v1/notification-preferences")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        pairs = {(row["event_category"], row["channel"]) for row in response.data}
        self.assertEqual(
            pairs,
            {
                (category, channel)
                for category in NotificationCategory.values
                for channel in NotificationChannel.values
            },
        )
        self.assertTrue(all(row["is_enabled"] for row in response.data))

    def test_patch_disabling_the_emergency_category_is_refused(self) -> None:
        response = self.client.patch(
            "/api/v1/notification-preferences",
            [
                {
                    "event_category": NotificationCategory.EMERGENCY,
                    "channel": NotificationChannel.SMS,
                    "is_enabled": False,
                }
            ],
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_patch_persists_and_the_next_get_reflects_it(self) -> None:
        response = self.client.patch(
            "/api/v1/notification-preferences",
            [
                {
                    "event_category": NotificationCategory.FEES,
                    "channel": NotificationChannel.SMS,
                    "is_enabled": False,
                }
            ],
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

        response = self.client.get("/api/v1/notification-preferences")
        row = next(
            r
            for r in response.data
            if r["event_category"] == NotificationCategory.FEES
            and r["channel"] == NotificationChannel.SMS
        )
        self.assertFalse(row["is_enabled"])
