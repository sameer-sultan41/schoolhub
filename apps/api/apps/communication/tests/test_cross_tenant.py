"""Cross-tenant access on every communication endpoint this PR ships.

AGENTS.md invariant 2: a tenant-A caller reaching for a tenant-B resource gets
**404, never 403** — matching every other module's own test file of this name.
"""

from __future__ import annotations

import uuid

from rest_framework import status

from apps.communication.tests.base import CommunicationAPITestCase
from apps.communication.tests.factories import (
    AnnouncementFactory,
    NoticeFactory,
    NotificationTemplateOverrideFactory,
    TenantFactory,
)
from core.notifications.models import DeliveryLog, Notification, NotificationChannel
from core.notifications.templates import registry as platform_templates
from core.tenancy.context import tenant_context

CODE = "communication-cross-tenant-test.event"


class CommunicationCrossTenantTests(CommunicationAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self._saved_templates = platform_templates._templates.copy()  # noqa: SLF001
        platform_templates.register(
            CODE, channel=NotificationChannel.IN_APP, subject="Hi", body="Body", variables=set()
        )
        self.other_tenant = TenantFactory()
        with tenant_context(self.other_tenant.id):
            self.other_override = NotificationTemplateOverrideFactory(
                tenant=self.other_tenant, code=CODE, channel=NotificationChannel.IN_APP
            )
            other_notification = Notification.objects.create(
                tenant_id=self.other_tenant.pk,
                user_id=uuid.uuid4(),
                event_key=CODE,
                title="Hi",
                body="Body",
            )
            self.other_delivery_log = DeliveryLog.objects.create(
                tenant_id=self.other_tenant.pk,
                notification=other_notification,
                channel=NotificationChannel.IN_APP,
                recipient_address="x",
            )
            self.other_announcement = AnnouncementFactory(tenant=self.other_tenant)
            self.other_notice = NoticeFactory(tenant=self.other_tenant)

    def tearDown(self) -> None:
        platform_templates._templates = self._saved_templates  # noqa: SLF001
        super().tearDown()

    def test_reading_another_tenants_template_override_is_404(self) -> None:
        response = self.client.get(f"/api/v1/notification-templates/{self.other_override.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_previewing_another_tenants_template_override_is_404(self) -> None:
        response = self.client.post(
            f"/api/v1/notification-templates/{self.other_override.pk}:preview"
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_patching_another_tenants_template_override_is_404(self) -> None:
        response = self.client.patch(
            f"/api/v1/notification-templates/{self.other_override.pk}",
            {"body": "Hijacked"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_reading_another_tenants_delivery_log_is_404(self) -> None:
        response = self.client.get(f"/api/v1/delivery-logs/{self.other_delivery_log.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_reading_another_tenants_announcement_is_404(self) -> None:
        response = self.client.get(f"/api/v1/announcements/{self.other_announcement.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_publishing_another_tenants_announcement_is_404(self) -> None:
        response = self.client.post(f"/api/v1/announcements/{self.other_announcement.pk}:publish")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_reading_another_tenants_notice_is_404(self) -> None:
        response = self.client.get(f"/api/v1/notices/{self.other_notice.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_submitting_another_tenants_notice_is_404(self) -> None:
        response = self.client.post(f"/api/v1/notices/{self.other_notice.pk}:submit")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_publishing_another_tenants_notice_is_404(self) -> None:
        response = self.client.post(f"/api/v1/notices/{self.other_notice.pk}:publish")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_acknowledging_another_tenants_notice_is_404(self) -> None:
        response = self.client.post(f"/api/v1/notices/{self.other_notice.pk}:acknowledge")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_downloading_another_tenants_notice_is_404(self) -> None:
        response = self.client.get(f"/api/v1/notices/{self.other_notice.pk}/download")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
