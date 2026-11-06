"""A guardian may attach only a thread file they uploaded themselves."""

from __future__ import annotations

from rest_framework import status

from apps.communication import uploads
from apps.communication.models import ThreadType
from apps.communication.tests.factories import UserFactory, authenticate, grant
from apps.communication.threads.tests.base import STAFF_THREAD_KEYS, ThreadAPITestCase
from core.files.tests.factories import FileFactory
from core.tenancy.context import tenant_context

THREADS_URL = "/api/v1/message-threads"


class ThreadAttachmentOwnershipTests(ThreadAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.teacher = UserFactory(tenant=self.tenant)
            grant(self.teacher, *STAFF_THREAD_KEYS)
        self.thread = self.make_thread(
            self.teacher,
            self.guardian_user,
            thread_type=ThreadType.GUARDIAN_SCHOOL,
            student=self.student,
        )

    def attachment(self, owner):
        with tenant_context(self.tenant.id):
            return FileFactory(
                tenant=self.tenant, purpose=uploads.THREAD_ATTACHMENT.key, created_by=owner.pk
            )

    def reply(self, user, file):
        authenticate(self.client, user)
        return self.client.post(
            f"{THREADS_URL}/{self.thread.pk}/messages",
            {"body": "Here it is.", "attachments": [str(file.pk)]},
            format="json",
        )

    def test_guardian_attaches_own_file(self) -> None:
        response = self.reply(self.guardian_user, self.attachment(self.guardian_user))

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())

    def test_thread_message_with_someone_elses_file_is_422(self) -> None:
        response = self.reply(self.guardian_user, self.attachment(self.teacher))

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        fields = {d["field"] for d in response.json()["error"]["details"]}
        self.assertEqual(fields, {"attachments"})

    def test_staff_may_attach_a_file_a_colleague_uploaded(self) -> None:
        response = self.reply(self.teacher, self.attachment(self.guardian_user))

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
