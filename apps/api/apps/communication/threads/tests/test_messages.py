"""`/message-threads/{id}/messages` and `:mark-read` — posting, reading and receipts."""

from __future__ import annotations

import datetime

from django.db import connection
from django.http import Http404
from django.test.utils import CaptureQueriesContext
from rest_framework import status

from apps.communication import uploads
from apps.communication.models import Message, MessageThread, ThreadStatus, ThreadType
from apps.communication.notifications import THREAD_REPLY
from apps.communication.tests.factories import (
    MessageFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.communication.threads.services.post_message import post_message
from apps.communication.threads.tests.base import STAFF_THREAD_KEYS, ThreadAPITestCase
from core.files.models import FileStatus
from core.files.tests.factories import FileFactory
from core.notifications.models import Notification
from core.tenancy.context import tenant_context

URL = "/api/v1/message-threads"


def messages_url(thread) -> str:
    return f"{URL}/{thread.pk}/messages"


def foreign_thread_attachment():
    """A ready, correctly-purposed thread attachment belonging to another tenant."""
    other_tenant = TenantFactory()
    with tenant_context(other_tenant.id):
        return FileFactory(tenant=other_tenant, purpose=uploads.THREAD_ATTACHMENT.key)


class MessageTestCase(ThreadAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.colleague = UserFactory(tenant=self.tenant)
            grant(self.colleague, *STAFF_THREAD_KEYS)

    def post(self, thread, body: str = "A reply.", **payload):
        return self.client.post(messages_url(thread), {"body": body, **payload}, format="json")

    def guardian_thread(self, *staff):
        """A guardian-school thread about `self.student`: staff first, then the guardian."""
        return self.make_thread(
            *staff,
            self.guardian_user,
            thread_type=ThreadType.GUARDIAN_SCHOOL,
            student=self.student,
        )

    def reply_recipients(self, thread) -> list[str]:
        """Who `THREAD_REPLY` reached for ``thread``, one entry per notification row."""
        with tenant_context(self.tenant.id):
            return sorted(
                str(user_id)
                for user_id in Notification.objects.filter(
                    event_key=THREAD_REPLY, source_id=thread.pk
                ).values_list("user_id", flat=True)
            )

    def message_count(self, thread) -> int:
        with tenant_context(self.tenant.id):
            return Message.objects.filter(thread=thread).count()

    def revoke_guardian(self) -> None:
        with tenant_context(self.tenant.id):
            self.guardian_link.has_portal_access = False
            self.guardian_link.save(update_fields=["has_portal_access"])


class PostMessageTests(MessageTestCase):
    def test_non_participant_post_is_404(self) -> None:
        with tenant_context(self.tenant.id):
            outsider = UserFactory(tenant=self.tenant)
            grant(outsider, *STAFF_THREAD_KEYS)
        thread = self.make_thread(self.user, self.colleague)
        authenticate(self.client, outsider)

        response = self.post(thread)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.message_count(thread), 1)

    def test_reply_on_closed_thread_is_409(self) -> None:
        thread = self.make_thread(self.user, self.colleague, status=ThreadStatus.CLOSED)

        response = self.post(thread)

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(self.message_count(thread), 1)

    def test_reply_bumps_last_message_at(self) -> None:
        thread = self.make_thread(self.user, self.colleague)
        with tenant_context(self.tenant.id):
            thread.last_message_at = datetime.datetime(2020, 1, 1, tzinfo=datetime.UTC)
            thread.save(update_fields=["last_message_at"])

        response = self.post(thread)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        with tenant_context(self.tenant.id):
            thread.refresh_from_db()
            message = Message.objects.get(pk=response.data["data"]["id"])
        self.assertEqual(thread.last_message_at, message.sent_at)
        self.assertEqual(response.data["data"]["sender_id"], str(self.user.pk))

    def test_reply_notifies_other_participants_once(self) -> None:
        with tenant_context(self.tenant.id):
            third = UserFactory(tenant=self.tenant)
            grant(third, *STAFF_THREAD_KEYS)
        thread = self.make_thread(self.user, self.colleague, third, thread_type=ThreadType.GROUP)

        response = self.post(thread)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        expected = sorted([str(self.colleague.pk), str(third.pk)])
        self.assertEqual(self.reply_recipients(thread), expected)

    def test_internal_note_hidden_from_and_not_notified_to_guardian(self) -> None:
        thread = self.guardian_thread(self.user, self.colleague)

        response = self.post(thread, body="Staff only: check the fee file.", is_internal_note=True)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(self.reply_recipients(thread), [str(self.colleague.pk)])
        staff_view = self.client.get(messages_url(thread))
        self.assertEqual(len(staff_view.data["data"]), 2)

        authenticate(self.client, self.guardian_user)
        guardian_view = self.client.get(messages_url(thread))

        self.assertEqual(guardian_view.status_code, status.HTTP_200_OK, guardian_view.data)
        self.assertEqual(len(guardian_view.data["data"]), 1)
        visible = [row["id"] for row in guardian_view.data["data"]]
        self.assertNotIn(response.data["data"]["id"], visible)

    def test_guardian_cannot_post_internal_note(self) -> None:
        thread = self.guardian_thread(self.user)
        authenticate(self.client, self.guardian_user)

        response = self.post(thread, is_internal_note=True)

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(self.message_count(thread), 1)

    def test_guardian_reply_notifies_staff(self) -> None:
        thread = self.guardian_thread(self.user)
        authenticate(self.client, self.guardian_user)

        response = self.post(thread, body="Thank you.")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(self.reply_recipients(thread), [str(self.user.pk)])

    def test_attachment_with_wrong_purpose_is_422(self) -> None:
        thread = self.make_thread(self.user, self.colleague)
        with tenant_context(self.tenant.id):
            document = FileFactory(tenant=self.tenant, purpose="student.document")

        response = self.post(thread, attachments=[str(document.pk)])

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(self.message_count(thread), 1)

    def test_attachment_not_yet_uploaded_is_422(self) -> None:
        thread = self.make_thread(self.user, self.colleague)
        with tenant_context(self.tenant.id):
            pending = FileFactory(
                tenant=self.tenant,
                purpose=uploads.THREAD_ATTACHMENT.key,
                status=FileStatus.PENDING,
            )

        response = self.post(thread, attachments=[str(pending.pk)])

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_unknown_attachment_is_404(self) -> None:
        thread = self.make_thread(self.user, self.colleague)

        response = self.post(thread, attachments=["00000000-0000-4000-8000-000000000000"])

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.message_count(thread), 1)

    def test_another_tenants_attachment_is_404(self) -> None:
        """A ready thread attachment, but another school's: as unknown as no file at all."""
        thread = self.make_thread(self.user, self.colleague)
        foreign = foreign_thread_attachment()

        response = self.post(thread, attachments=[str(foreign.pk)])

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.message_count(thread), 1)

    def test_thread_attachment_is_stored(self) -> None:
        thread = self.make_thread(self.user, self.colleague)
        with tenant_context(self.tenant.id):
            attachment = FileFactory(tenant=self.tenant, purpose=uploads.THREAD_ATTACHMENT.key)

        response = self.post(thread, attachments=[str(attachment.pk)])

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["data"]["attachments"], [str(attachment.pk)])

    def test_staff_without_message_create_cannot_post(self) -> None:
        with tenant_context(self.tenant.id):
            reader = UserFactory(tenant=self.tenant)
            grant(reader, "communication.thread.view")
        thread = self.make_thread(self.user, reader)
        authenticate(self.client, reader)

        response = self.post(thread)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class OpeningMessageAttachmentTests(MessageTestCase):
    """`create_thread` posts its first message through `post_message`, so the
    attachment checks guard `POST /message-threads` too."""

    def start_thread(self, attachments: list[str]):
        return self.client.post(
            URL,
            {
                "subject": "Timetable",
                "thread_type": ThreadType.INTERNAL,
                "participant_user_ids": [str(self.colleague.pk)],
                "body": "See attached.",
                "attachments": attachments,
            },
            format="json",
        )

    def test_another_tenants_attachment_on_create_is_404(self) -> None:
        foreign = foreign_thread_attachment()

        response = self.start_thread([str(foreign.pk)])

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        with tenant_context(self.tenant.id):
            self.assertFalse(MessageThread.objects.exists())
            self.assertFalse(Message.objects.exists())

    def test_wrong_purpose_attachment_on_create_is_422(self) -> None:
        with tenant_context(self.tenant.id):
            document = FileFactory(tenant=self.tenant, purpose="student.document")

        response = self.start_thread([str(document.pk)])

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        with tenant_context(self.tenant.id):
            self.assertFalse(MessageThread.objects.exists())

    def test_thread_attachment_on_create_is_stored(self) -> None:
        with tenant_context(self.tenant.id):
            attachment = FileFactory(tenant=self.tenant, purpose=uploads.THREAD_ATTACHMENT.key)

        response = self.start_thread([str(attachment.pk)])

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        with tenant_context(self.tenant.id):
            opening = Message.objects.get(thread_id=response.data["data"]["id"])
        self.assertEqual(opening.attachments, [str(attachment.pk)])


class RevokedGuardianTests(MessageTestCase):
    """A guardian whose portal access is revoked after the thread exists."""

    def test_post_message_service_refuses_revoked_guardian(self) -> None:
        """The service holds the rule too, for callers that never reach the view."""
        thread = self.guardian_thread(self.user)
        self.revoke_guardian()

        with tenant_context(self.tenant.id), self.assertRaises(Http404):
            post_message(
                thread=thread,
                sender=self.guardian_user,
                body="Still here?",
                attachments=None,
                is_internal_note=False,
            )

    def test_revoked_guardian_is_not_notified_of_a_reply(self) -> None:
        thread = self.guardian_thread(self.user, self.colleague)
        self.revoke_guardian()

        response = self.post(thread)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(self.reply_recipients(thread), [str(self.colleague.pk)])


class OpeningMessageNotificationTests(MessageTestCase):
    def test_opening_message_notifies_routed_staff(self) -> None:
        """Starting a thread posts its first message through `post_message`, so the
        class teacher it is routed to hears of it — and the guardian who wrote it does not."""
        teacher = self.make_class_teacher()
        authenticate(self.client, self.guardian_user)

        response = self.client.post(
            URL,
            {
                "subject": "Sports day",
                "thread_type": ThreadType.GUARDIAN_SCHOOL,
                "student_id": str(self.student.pk),
                "body": "Is the kit list out yet?",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        with tenant_context(self.tenant.id):
            rows = list(
                Notification.objects.filter(event_key=THREAD_REPLY).values_list(
                    "user_id", "source_id", "title"
                )
            )
        self.assertEqual(len(rows), 1)
        user_id, source_id, title = rows[0]
        self.assertEqual(user_id, teacher.pk)
        self.assertEqual(str(source_id), response.data["data"]["id"])
        self.assertEqual(title, "Sports day")


class ListMessagesTests(MessageTestCase):
    def test_list_is_newest_first(self) -> None:
        thread = self.make_thread(self.colleague, self.user)
        with tenant_context(self.tenant.id):
            opening = Message.objects.get(thread=thread)
            newer = MessageFactory(
                thread=thread,
                sender_id=self.colleague.pk,
                sent_at=opening.sent_at + datetime.timedelta(minutes=5),
            )

        response = self.client.get(messages_url(thread))

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(
            [row["id"] for row in response.data["data"]], [str(newer.pk), str(opening.pk)]
        )

    def test_list_messages_of_a_thread_one_is_not_in_is_404(self) -> None:
        with tenant_context(self.tenant.id):
            stranger = UserFactory(tenant=self.tenant)
        thread = self.make_thread(self.colleague, stranger)

        response = self.client.get(messages_url(thread))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_list_messages_query_count_is_constant(self) -> None:
        thread = self.make_thread(self.colleague, self.user)
        with tenant_context(self.tenant.id):
            MessageFactory.create_batch(2, thread=thread, sender_id=self.colleague.pk)
        # Warm any per-process caches (feature flags, permissions) before counting.
        self.client.get(messages_url(thread))

        with CaptureQueriesContext(connection) as few:
            self.client.get(messages_url(thread))
        with tenant_context(self.tenant.id):
            MessageFactory.create_batch(27, thread=thread, sender_id=self.colleague.pk)
        with CaptureQueriesContext(connection) as many:
            response = self.client.get(messages_url(thread))

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(len(many.captured_queries), len(few.captured_queries))


class MarkReadTests(MessageTestCase):
    def mark_read(self, thread):
        return self.client.post(f"{URL}/{thread.pk}:mark-read")

    def read_by(self, thread) -> list[dict | None]:
        with tenant_context(self.tenant.id):
            return list(
                Message.objects.filter(thread=thread)
                .order_by("sent_at", "id")
                .values_list("read_by", flat=True)
            )

    def test_mark_read_sets_read_by_and_zeroes_unread_count(self) -> None:
        thread = self.make_thread(self.colleague, self.user)
        with tenant_context(self.tenant.id):
            MessageFactory(thread=thread, sender_id=self.colleague.pk)
            MessageFactory(thread=thread, sender_id=self.user.pk)  # mine: never stamped
        self.assertEqual(self.client.get(URL).data["data"][0]["unread_count"], 2)

        response = self.mark_read(thread)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["data"], {"marked": 2})
        with tenant_context(self.tenant.id):
            stamped = Message.objects.filter(thread=thread, sender_id=self.colleague.pk)
            for message in stamped:
                self.assertIn(str(self.user.pk), message.read_by)
            own = Message.objects.get(thread=thread, sender_id=self.user.pk)
        self.assertIsNone(own.read_by)
        self.assertEqual(self.client.get(URL).data["data"][0]["unread_count"], 0)

    def test_mark_read_is_idempotent(self) -> None:
        thread = self.make_thread(self.colleague, self.user)
        self.mark_read(thread)
        first = self.read_by(thread)

        response = self.mark_read(thread)

        self.assertEqual(response.data["data"], {"marked": 0})
        self.assertEqual(self.read_by(thread), first)

    def test_mark_read_keeps_other_readers_stamps(self) -> None:
        thread = self.make_thread(self.colleague, self.user)
        with tenant_context(self.tenant.id):
            message = MessageFactory(
                thread=thread,
                sender_id=self.colleague.pk,
                read_by={"someone-else": "2026-10-31T10:00:00+00:00"},
            )

        self.mark_read(thread)

        with tenant_context(self.tenant.id):
            message.refresh_from_db()
        self.assertEqual(set(message.read_by), {"someone-else", str(self.user.pk)})
        self.assertEqual(message.read_by["someone-else"], "2026-10-31T10:00:00+00:00")

    def test_guardian_mark_read_skips_internal_notes(self) -> None:
        thread = self.guardian_thread(self.user)
        with tenant_context(self.tenant.id):
            note = MessageFactory(thread=thread, sender_id=self.user.pk, is_internal_note=True)
        authenticate(self.client, self.guardian_user)

        response = self.mark_read(thread)

        self.assertEqual(response.data["data"], {"marked": 1})
        with tenant_context(self.tenant.id):
            note.refresh_from_db()
        self.assertIsNone(note.read_by)

    def test_mark_read_on_a_thread_one_is_not_in_is_404(self) -> None:
        with tenant_context(self.tenant.id):
            stranger = UserFactory(tenant=self.tenant)
        thread = self.make_thread(self.colleague, stranger)

        response = self.mark_read(thread)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
