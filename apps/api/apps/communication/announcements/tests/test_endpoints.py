"""Announcements — HTTP endpoint round trips."""

from __future__ import annotations

from rest_framework import status

from apps.communication.models import AnnouncementStatus, AudienceType
from apps.communication.tests.base import CommunicationAPITestCase
from apps.communication.tests.factories import AnnouncementFactory, UserFactory
from core.tenancy.context import tenant_context


class AnnouncementEndpointTests(CommunicationAPITestCase):
    def test_create_and_publish_round_trip(self) -> None:
        with tenant_context(self.tenant.id):
            recipient = UserFactory(tenant=self.tenant)

        response = self.client.post(
            "/api/v1/announcements",
            {
                "title": "Sports day",
                "body": "Sports day is next Friday.",
                "audience_type": AudienceType.CUSTOM,
                "audience_filter": {"user_ids": [str(recipient.pk)]},
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        announcement_id = response.data["id"]

        response = self.client.post(f"/api/v1/announcements/{announcement_id}:publish")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["data"]["status"], AnnouncementStatus.PUBLISHED)

    def test_publishing_with_zero_recipients_is_refused_with_a_422(self) -> None:
        with tenant_context(self.tenant.id):
            announcement = AnnouncementFactory(
                tenant=self.tenant,
                audience_type=AudienceType.CUSTOM,
                audience_filter={"user_ids": []},
            )

        response = self.client.post(f"/api/v1/announcements/{announcement.pk}:publish")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
