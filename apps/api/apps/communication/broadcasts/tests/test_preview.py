"""`POST /broadcasts:preview` — count, digest, channels, and who may ask."""

from __future__ import annotations

from rest_framework import status

from apps.communication.broadcasts.tests.base import (
    PREVIEW_URL,
    SEND_URL,
    BroadcastAPITestCase,
    expected_digest,
)
from apps.communication.models import AudienceType
from apps.communication.tests.factories import (
    ClassFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
)
from core.jobs.models import BackgroundJob
from core.tenancy.context import tenant_context


class BroadcastPreviewTests(BroadcastAPITestCase):
    def test_preview_returns_count_digest_and_splits_unavailable_channels(self) -> None:
        response = self.preview(self.audience(self.alice, self.bob))

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        data = response.json()["data"]
        self.assertEqual(data["recipient_count"], 2)
        self.assertEqual(data["audience_digest"], expected_digest(self.alice, self.bob))
        self.assertEqual(data["channels"], ["email", "in_app"])
        self.assertEqual(data["unavailable_channels"], ["push", "sms", "whatsapp"])

    def test_preview_digest_ignores_the_order_ids_were_given_in(self) -> None:
        forward = self.preview(self.audience(self.alice, self.bob)).json()["data"]
        backward = self.preview(self.audience(self.bob, self.alice)).json()["data"]

        self.assertEqual(forward["audience_digest"], backward["audience_digest"])

    def test_preview_empty_audience_is_422(self) -> None:
        response = self.preview(self.audience())

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_preview_rejects_a_message_over_the_limit(self) -> None:
        body = {**self.audience(self.alice), "message": "x" * 1001}

        response = self.preview(body)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_foreign_class_id_is_404(self) -> None:
        other_tenant = TenantFactory()
        with tenant_context(other_tenant.id):
            foreign_class = ClassFactory(tenant=other_tenant)

        response = self.preview(
            {
                "audience_type": AudienceType.CLASS,
                "audience_filter": {"class_ids": [str(foreign_class.pk)]},
                "message": "Hi.",
            }
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_foreign_user_among_own_users_is_404(self) -> None:
        other_tenant = TenantFactory()
        with tenant_context(other_tenant.id):
            foreign_user = UserFactory(tenant=other_tenant)

        response = self.preview(self.audience(self.alice, foreign_user))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class BroadcastPermissionTests(BroadcastAPITestCase):
    def test_send_requires_broadcast_send_key(self) -> None:
        with tenant_context(self.tenant.id):
            publisher = UserFactory(tenant=self.tenant)
            grant(publisher, "communication.announcement.publish")
        body = self.confirmed(self.alice)
        authenticate(self.client, publisher)

        preview = self.client.post(PREVIEW_URL, self.audience(self.alice), format="json")
        send = self.client.post(SEND_URL, body, format="json")

        self.assertEqual(preview.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(send.status_code, status.HTTP_403_FORBIDDEN)
        with tenant_context(self.tenant.id):
            self.assertFalse(BackgroundJob.objects.exists())

    def test_guardian_cannot_broadcast(self) -> None:
        with tenant_context(self.tenant.id):
            guardian = UserFactory(tenant=self.tenant)
            # Even holding the key: a restricted principal never reaches a staff endpoint.
            grant(guardian, "communication.broadcast.send", is_restricted_principal=True)
        body = self.confirmed(self.alice)
        authenticate(self.client, guardian)

        preview = self.client.post(PREVIEW_URL, self.audience(self.alice), format="json")
        send = self.client.post(SEND_URL, body, format="json")

        self.assertEqual(preview.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(send.status_code, status.HTTP_403_FORBIDDEN)
        with tenant_context(self.tenant.id):
            self.assertFalse(BackgroundJob.objects.exists())
