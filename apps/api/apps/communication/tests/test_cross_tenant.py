"""Cross-tenant access on every communication endpoint this PR ships.

AGENTS.md invariant 2: a tenant-A caller reaching for a tenant-B resource gets
**404, never 403** — matching every other module's own test file of this name.
"""

from __future__ import annotations

import uuid

from rest_framework import status

from apps.communication import uploads
from apps.communication.models import Message, MessageThread, ThreadStatus, ThreadType
from apps.communication.tests.base import CommunicationAPITestCase
from apps.communication.tests.factories import (
    AnnouncementFactory,
    CampusFactory,
    MessageThreadFactory,
    NoticeFactory,
    NotificationTemplateOverrideFactory,
    StudentFactory,
    TenantFactory,
    UserFactory,
    grant,
)
from core.files.tests.factories import FileFactory
from core.notifications.models import DeliveryLog, Notification, NotificationChannel
from core.notifications.templates import registry as platform_templates
from core.tenancy.context import tenant_context

CODE = "communication-cross-tenant-test.event"


class CommunicationCrossTenantTests(CommunicationAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self._saved_templates = platform_templates._templates.copy()
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
            self.other_user = UserFactory(tenant=self.other_tenant, first_name="Foreign")
            grant(self.other_user, "communication.thread.view")
            self.other_student = StudentFactory(
                tenant=self.other_tenant, campus=CampusFactory(tenant=self.other_tenant)
            )
            # Lists *this* tenant's caller as a participant: only tenancy, not
            # membership, can keep it out of their inbox.
            self.other_thread = MessageThreadFactory(
                tenant=self.other_tenant,
                participant_user_ids=[str(self.user.pk), str(self.other_user.pk)],
            )
            self.other_closed_thread = MessageThreadFactory(
                tenant=self.other_tenant,
                participant_user_ids=[str(self.user.pk), str(self.other_user.pk)],
                status=ThreadStatus.CLOSED,
            )

    def tearDown(self) -> None:
        platform_templates._templates = self._saved_templates
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

    def test_listing_threads_never_shows_another_tenants_thread(self) -> None:
        response = self.client.get("/api/v1/message-threads")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"], [])

    def test_reading_another_tenants_thread_is_404(self) -> None:
        response = self.client.get(f"/api/v1/message-threads/{self.other_thread.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_closing_another_tenants_thread_is_404(self) -> None:
        response = self.client.post(f"/api/v1/message-threads/{self.other_thread.pk}:close")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_reopening_another_tenants_thread_is_404(self) -> None:
        response = self.client.post(f"/api/v1/message-threads/{self.other_closed_thread.pk}:reopen")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_listing_another_tenants_thread_messages_is_404(self) -> None:
        response = self.client.get(f"/api/v1/message-threads/{self.other_thread.pk}/messages")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_posting_into_another_tenants_thread_is_404(self) -> None:
        response = self.client.post(
            f"/api/v1/message-threads/{self.other_thread.pk}/messages",
            {"body": "Hello."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        with tenant_context(self.other_tenant.id):
            self.assertFalse(Message.objects.filter(thread=self.other_thread).exists())

    def test_attaching_another_tenants_file_is_404(self) -> None:
        with tenant_context(self.tenant.id):
            colleague = UserFactory(tenant=self.tenant)
            mine = MessageThreadFactory(
                tenant=self.tenant,
                participant_user_ids=[str(self.user.pk), str(colleague.pk)],
            )
        with tenant_context(self.other_tenant.id):
            foreign_file = FileFactory(
                tenant=self.other_tenant, purpose=uploads.THREAD_ATTACHMENT.key
            )

        response = self.client.post(
            f"/api/v1/message-threads/{mine.pk}/messages",
            {"body": "Hello.", "attachments": [str(foreign_file.pk)]},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        with tenant_context(self.tenant.id):
            self.assertFalse(Message.objects.filter(thread=mine).exists())

    def test_marking_another_tenants_thread_read_is_404(self) -> None:
        response = self.client.post(f"/api/v1/message-threads/{self.other_thread.pk}:mark-read")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_recipients_never_lists_another_tenants_user(self) -> None:
        response = self.client.get("/api/v1/message-threads/recipients", {"search": "Foreign"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"], [])

    def test_starting_a_thread_about_another_tenants_student_is_404(self) -> None:
        response = self.client.post(
            "/api/v1/message-threads",
            {
                "subject": "Hello",
                "thread_type": ThreadType.GUARDIAN_SCHOOL,
                "student_id": str(self.other_student.pk),
                "body": "Hi.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        with tenant_context(self.tenant.id):
            self.assertFalse(MessageThread.objects.exists())

    def test_starting_a_thread_with_another_tenants_user_is_404(self) -> None:
        response = self.client.post(
            "/api/v1/message-threads",
            {
                "subject": "Hello",
                "thread_type": ThreadType.INTERNAL,
                "participant_user_ids": [str(self.other_user.pk)],
                "body": "Hi.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        with tenant_context(self.tenant.id):
            self.assertFalse(MessageThread.objects.exists())
