"""Two plain users the caller can target as a `custom` audience.

The caller (`self.user`) is a scope-`all` staff member holding every
communication key, `broadcast.send` included.
"""

from __future__ import annotations

import hashlib

from rest_framework.response import Response

from apps.communication.models import AudienceType
from apps.communication.tests.base import CommunicationAPITestCase
from apps.communication.tests.factories import UserFactory
from core.tenancy.context import tenant_context

PREVIEW_URL = "/api/v1/broadcasts:preview"
SEND_URL = "/api/v1/broadcasts:emergency"
MESSAGE = "School closes at noon today."


def expected_digest(*users) -> str:
    """Written out here rather than imported, so a change to the service's rule shows."""
    return hashlib.sha256(",".join(sorted(str(u.pk) for u in users)).encode()).hexdigest()


class BroadcastAPITestCase(CommunicationAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.alice = UserFactory(tenant=self.tenant)
            self.bob = UserFactory(tenant=self.tenant)

    def audience(self, *users) -> dict:
        return {
            "audience_type": AudienceType.CUSTOM,
            "audience_filter": {"user_ids": [str(user.pk) for user in users]},
            "message": MESSAGE,
        }

    def preview(self, body: dict) -> Response:
        return self.client.post(PREVIEW_URL, body, format="json")

    def send(self, body: dict, **extra) -> Response:
        return self.client.post(SEND_URL, body, format="json", **extra)

    def confirmed(self, *users) -> dict:
        """A send body repeating back what the preview of ``users`` returned."""
        body = self.audience(*users)
        preview = self.preview(body)
        self.assertEqual(preview.status_code, 200, preview.json())
        data = preview.json()["data"]
        return {
            **body,
            "confirm_recipient_count": data["recipient_count"],
            "audience_digest": data["audience_digest"],
        }
