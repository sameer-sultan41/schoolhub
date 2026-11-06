"""Thread attachments: off the generic `/files` routes, downloaded through the thread.

`communication.thread-attachment` is module-gated (`apps/communication/uploads.py`),
so a staff member who merely holds `platform.file.view` can neither list nor sign
one. A participant downloads through `/message-threads/{id}/attachments/…`, an
overseer through the audited `/message-thread-oversight/{id}/attachments/…`.
"""

from __future__ import annotations

from rest_framework import status

from apps.communication import uploads
from apps.communication.models import ThreadType
from apps.communication.oversight.viewset import AUDIT_OVERSIGHT_DOWNLOAD_ATTACHMENT
from apps.communication.tests.factories import MessageFactory, UserFactory, authenticate, grant
from apps.communication.threads.tests.base import STAFF_THREAD_KEYS, ThreadAPITestCase
from core.audit.models import AuditLog
from core.files.models import FileStatus
from core.files.tests.factories import FileFactory
from core.tenancy.context import tenant_context

THREADS_URL = "/api/v1/message-threads"
OVERSIGHT_URL = "/api/v1/message-thread-oversight"
FILES_URL = "/api/v1/files"


def download_url(base: str, thread, file) -> str:
    return f"{base}/{thread.pk}/attachments/{file.pk}:download"


class ThreadAttachmentTestCase(ThreadAPITestCase):
    """A guardian thread with a teacher, carrying one attachment on an ordinary
    message and another only on an internal note."""

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
        with tenant_context(self.tenant.id):
            self.letter = self.attachment()
            self.note_file = self.attachment()
            MessageFactory(
                thread=self.thread, sender_id=self.teacher.pk, attachments=[str(self.letter.pk)]
            )
            MessageFactory(
                thread=self.thread,
                sender_id=self.teacher.pk,
                attachments=[str(self.note_file.pk)],
                is_internal_note=True,
            )

    def attachment(self, **fields):
        return FileFactory(tenant=self.tenant, purpose=uploads.THREAD_ATTACHMENT.key, **fields)

    def download(self, file, *, thread=None, base: str = THREADS_URL):
        return self.client.post(download_url(base, thread or self.thread, file))


class GenericFilesRouteTests(ThreadAttachmentTestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.librarian = UserFactory(tenant=self.tenant)
            grant(self.librarian, "platform.file.create", "platform.file.view")
        authenticate(self.client, self.librarian)

    def test_staff_non_participant_cannot_list_or_download_through_files(self) -> None:
        listed = self.client.get(FILES_URL, {"purpose": uploads.THREAD_ATTACHMENT.key})
        retrieve = self.client.get(f"{FILES_URL}/{self.letter.pk}")
        download = self.client.post(f"{FILES_URL}/{self.letter.pk}:download")

        self.assertEqual(listed.status_code, status.HTTP_200_OK, listed.json())
        listed_ids = {row["id"] for row in listed.json()["data"]}
        self.assertNotIn(str(self.letter.pk), listed_ids)
        self.assertNotIn(str(self.note_file.pk), listed_ids)
        self.assertEqual(retrieve.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(download.status_code, status.HTTP_404_NOT_FOUND)

    def test_staff_still_upload_and_confirm_a_thread_attachment(self) -> None:
        created = self.client.post(
            FILES_URL,
            {
                "original_name": "letter.pdf",
                "mime_type": "application/pdf",
                "size_bytes": 1024,
                "purpose": uploads.THREAD_ATTACHMENT.key,
            },
            format="json",
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.json())

        confirmed = self.client.post(f"{FILES_URL}/{created.json()['data']['id']}:confirm")

        self.assertEqual(confirmed.status_code, status.HTTP_200_OK, confirmed.json())
        self.assertEqual(confirmed.json()["data"]["status"], FileStatus.READY)


class ParticipantDownloadTests(ThreadAttachmentTestCase):
    def test_staff_participant_downloads_an_attachment(self) -> None:
        authenticate(self.client, self.teacher)

        for file in (self.letter, self.note_file):
            with self.subTest(file=file.original_name):
                response = self.download(file)
                self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
                self.assertIn("download_url", response.json()["data"])

    def test_guardian_downloads_an_attachment_on_an_ordinary_message(self) -> None:
        authenticate(self.client, self.guardian_user)

        response = self.download(self.letter)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertIn("download_url", response.json()["data"])

    def test_guardian_cannot_download_an_internal_note_attachment(self) -> None:
        authenticate(self.client, self.guardian_user)

        response = self.download(self.note_file)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_file_not_attached_in_this_thread_is_404(self) -> None:
        other_thread = self.make_thread(self.teacher, self.user)
        with tenant_context(self.tenant.id):
            elsewhere = self.attachment()
            MessageFactory(
                thread=other_thread, sender_id=self.user.pk, attachments=[str(elsewhere.pk)]
            )
            unattached = self.attachment()
        authenticate(self.client, self.teacher)

        for file in (elsewhere, unattached):
            with self.subTest(file=file.original_name):
                self.assertEqual(self.download(file).status_code, status.HTTP_404_NOT_FOUND)

    def test_a_non_participant_is_404(self) -> None:
        # `self.user` is scope-`all` staff with every key, but not in this thread.
        response = self.download(self.letter)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_revoked_guardian_is_404(self) -> None:
        with tenant_context(self.tenant.id):
            self.guardian_link.has_portal_access = False
            self.guardian_link.save(update_fields=["has_portal_access"])
        authenticate(self.client, self.guardian_user)

        response = self.download(self.letter)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_participant_download_writes_no_audit_row(self) -> None:
        authenticate(self.client, self.teacher)

        self.download(self.letter)

        self.assertFalse(AuditLog.objects.filter(resource_id=self.thread.pk).exists())


class OversightDownloadTests(ThreadAttachmentTestCase):
    """`self.user` holds `communication.thread.oversee` and takes no part in the thread."""

    def test_overseer_downloads_an_internal_note_attachment_and_it_is_audited(self) -> None:
        response = self.download(self.note_file, base=OVERSIGHT_URL)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertIn("download_url", response.json()["data"])
        row = AuditLog.objects.get(
            action=AUDIT_OVERSIGHT_DOWNLOAD_ATTACHMENT, resource_id=self.thread.pk
        )
        self.assertEqual(row.actor_id, self.user.pk)
        self.assertEqual(row.after, {"file_id": str(self.note_file.pk)})

    def test_a_file_not_in_the_thread_is_404_and_unaudited(self) -> None:
        with tenant_context(self.tenant.id):
            unattached = self.attachment()

        response = self.download(unattached, base=OVERSIGHT_URL)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(
            AuditLog.objects.filter(action=AUDIT_OVERSIGHT_DOWNLOAD_ATTACHMENT).exists()
        )

    def test_a_participant_without_oversee_is_403(self) -> None:
        # The teacher reads this thread as a participant, but holds no oversight key.
        authenticate(self.client, self.teacher)

        response = self.download(self.letter, base=OVERSIGHT_URL)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
