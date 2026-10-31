"""`/message-threads` — the participant-scoped inbox, close/reopen and recipients."""

from __future__ import annotations

from rest_framework import status
from rest_framework.exceptions import PermissionDenied

from apps.communication.models import Message, ThreadStatus, ThreadType
from apps.communication.notifications import THREAD_REPLY
from apps.communication.tests.factories import (
    MessageFactory,
    StudentFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.communication.threads.services.close import close_thread
from apps.communication.threads.tests.base import (
    GUARDIAN_THREAD_KEYS,
    STAFF_THREAD_KEYS,
    ThreadAPITestCase,
)
from core.notifications.models import Notification
from core.tenancy.context import tenant_context

URL = "/api/v1/message-threads"


class InboxTests(ThreadAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.colleague = UserFactory(tenant=self.tenant)
            grant(self.colleague, *STAFF_THREAD_KEYS)
            self.stranger = UserFactory(tenant=self.tenant)
            grant(self.stranger, *STAFF_THREAD_KEYS)

    def listed_ids(self, response) -> list[str]:
        return [row["id"] for row in response.data["data"]]

    def test_list_shows_only_participant_threads_even_for_scope_all_admin(self) -> None:
        mine = self.make_thread(self.user, self.colleague)
        self.make_thread(self.colleague, self.stranger)

        response = self.client.get(URL)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(self.listed_ids(response), [str(mine.pk)])

    def test_retrieve_non_participant_is_404(self) -> None:
        theirs = self.make_thread(self.colleague, self.stranger)

        response = self.client.get(f"{URL}/{theirs.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_retrieve_participant_thread(self) -> None:
        mine = self.make_thread(self.user, self.colleague)

        response = self.client.get(f"{URL}/{mine.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["id"], str(mine.pk))

    def test_list_is_ordered_by_latest_activity(self) -> None:
        older = self.make_thread(self.user, self.colleague)
        newer = self.make_thread(self.user, self.colleague)
        with tenant_context(self.tenant.id):
            older.last_message_at = newer.last_message_at.replace(year=2020)
            older.save(update_fields=["last_message_at"])

        response = self.client.get(URL)

        self.assertEqual(self.listed_ids(response), [str(newer.pk), str(older.pk)])

    def test_list_filters_by_status_and_type(self) -> None:
        open_thread = self.make_thread(self.user, self.colleague)
        self.make_thread(self.user, self.colleague, status=ThreadStatus.CLOSED)
        self.make_thread(self.user, self.colleague, self.stranger, thread_type=ThreadType.GROUP)

        response = self.client.get(
            URL, {"status": ThreadStatus.OPEN, "thread_type": ThreadType.INTERNAL}
        )

        self.assertEqual(self.listed_ids(response), [str(open_thread.pk)])

    def test_unread_count_excludes_own_messages(self) -> None:
        thread = self.make_thread(self.user, self.colleague)  # opening message is mine
        with tenant_context(self.tenant.id):
            MessageFactory(thread=thread, sender_id=self.colleague.pk)
            MessageFactory(
                thread=thread,
                sender_id=self.colleague.pk,
                read_by={str(self.user.pk): "2026-10-31T10:00:00+00:00"},
            )
            # Read by someone else, not by the caller: still unread for them.
            MessageFactory(
                thread=thread,
                sender_id=self.colleague.pk,
                read_by={str(self.stranger.pk): "2026-10-31T10:00:00+00:00"},
            )

        response = self.client.get(URL)

        self.assertEqual(response.data["data"][0]["unread_count"], 2)

    def test_unread_count_hides_internal_notes_from_a_guardian(self) -> None:
        thread = self.make_thread(
            self.user,
            self.guardian_user,
            thread_type=ThreadType.GUARDIAN_SCHOOL,
            student=self.student,
        )
        with tenant_context(self.tenant.id):
            MessageFactory(thread=thread, sender_id=self.user.pk, is_internal_note=True)
            MessageFactory(thread=thread, sender_id=self.user.pk)
        authenticate(self.client, self.guardian_user)

        response = self.client.get(URL)

        # The opening message and the reply; never the internal note.
        self.assertEqual(response.data["data"][0]["unread_count"], 2)


class RoutedThreadVisibilityTests(ThreadAPITestCase):
    """A guardian's thread, as the class teacher it was routed to and the guardian see it."""

    def setUp(self) -> None:
        super().setUp()
        self.teacher = self.make_class_teacher()
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
        self.thread_id = response.data["data"]["id"]

    def test_assigned_scope_class_teacher_sees_routed_thread(self) -> None:
        authenticate(self.client, self.teacher)

        listed = self.client.get(URL)
        opened = self.client.get(f"{URL}/{self.thread_id}")

        self.assertEqual([row["id"] for row in listed.data["data"]], [self.thread_id])
        self.assertEqual(listed.data["data"][0]["unread_count"], 1)
        self.assertEqual(opened.status_code, status.HTTP_200_OK, opened.data)

    def test_revoked_guardian_loses_thread_on_list_and_retrieve(self) -> None:
        self.assertEqual(len(self.client.get(URL).data["data"]), 1)
        with tenant_context(self.tenant.id):
            self.guardian_link.has_portal_access = False
            self.guardian_link.save(update_fields=["has_portal_access"])

        listed = self.client.get(URL)
        opened = self.client.get(f"{URL}/{self.thread_id}")

        self.assertEqual(listed.data["data"], [])
        self.assertEqual(opened.status_code, status.HTTP_404_NOT_FOUND)

    def test_assigned_scope_class_teacher_replies(self) -> None:
        """The post half: the routed class teacher answers, and the guardian hears of it."""
        authenticate(self.client, self.teacher)

        response = self.client.post(
            f"{URL}/{self.thread_id}/messages", {"body": "Yes — on the portal."}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        with tenant_context(self.tenant.id):
            notified = list(
                Notification.objects.filter(
                    event_key=THREAD_REPLY, user_id=self.guardian_user.pk
                ).values_list("source_id", flat=True)
            )
        self.assertEqual([str(source_id) for source_id in notified], [self.thread_id])

    def test_revoked_guardian_cannot_post(self) -> None:
        with tenant_context(self.tenant.id):
            self.guardian_link.has_portal_access = False
            self.guardian_link.save(update_fields=["has_portal_access"])

        response = self.client.post(
            f"{URL}/{self.thread_id}/messages", {"body": "Still there?"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        with tenant_context(self.tenant.id):
            self.assertEqual(Message.objects.filter(thread_id=self.thread_id).count(), 1)

    def test_guardian_sees_only_threads_about_their_own_child(self) -> None:
        """A thread naming a child the guardian does not own stays hidden, even if
        their id is (wrongly) among the participants."""
        with tenant_context(self.tenant.id):
            other_child = StudentFactory(tenant=self.tenant, campus=self.campus)
        stray = self.make_thread(
            self.user,
            self.guardian_user,
            thread_type=ThreadType.GUARDIAN_SCHOOL,
            student=other_child,
        )

        listed = self.client.get(URL)
        opened = self.client.get(f"{URL}/{stray.pk}")

        self.assertEqual([row["id"] for row in listed.data["data"]], [self.thread_id])
        self.assertEqual(opened.status_code, status.HTTP_404_NOT_FOUND)


class CloseReopenTests(ThreadAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.thread = self.make_thread(
            self.user,
            self.guardian_user,
            thread_type=ThreadType.GUARDIAN_SCHOOL,
            student=self.student,
        )

    def test_guardian_cannot_close_thread(self) -> None:
        authenticate(self.client, self.guardian_user)

        response = self.client.post(f"{URL}/{self.thread.pk}:close")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_guardian_holding_the_close_key_still_cannot_close(self) -> None:
        """A custom role cannot hand a guardian the close action."""
        with tenant_context(self.tenant.id):
            grant(self.guardian_user, "communication.thread.close", is_restricted_principal=True)
        authenticate(self.client, self.guardian_user)

        response = self.client.post(f"{URL}/{self.thread.pk}:close")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        with tenant_context(self.tenant.id):
            self.thread.refresh_from_db()
        self.assertEqual(self.thread.status, ThreadStatus.OPEN)

    def test_close_service_refuses_a_restricted_participant(self) -> None:
        """The service holds the rule too, for callers that never pass the permission class."""
        with tenant_context(self.tenant.id), self.assertRaises(PermissionDenied):
            close_thread(thread=self.thread, actor=self.guardian_user)

    def test_close_records_closed_at(self) -> None:
        response = self.client.post(f"{URL}/{self.thread.pk}:close")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["data"]["status"], ThreadStatus.CLOSED)
        self.assertIsNotNone(response.data["data"]["closed_at"])

    def test_close_twice_is_409(self) -> None:
        self.client.post(f"{URL}/{self.thread.pk}:close")

        response = self.client.post(f"{URL}/{self.thread.pk}:close")

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_reopen_closed_thread(self) -> None:
        self.client.post(f"{URL}/{self.thread.pk}:close")

        response = self.client.post(f"{URL}/{self.thread.pk}:reopen")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["data"]["status"], ThreadStatus.OPEN)
        self.assertIsNone(response.data["data"]["closed_at"])

    def test_reopen_open_thread_is_409(self) -> None:
        response = self.client.post(f"{URL}/{self.thread.pk}:reopen")

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_closing_a_thread_one_is_not_in_is_404(self) -> None:
        with tenant_context(self.tenant.id):
            outsider = UserFactory(tenant=self.tenant)
            grant(outsider, *STAFF_THREAD_KEYS)
        authenticate(self.client, outsider)

        response = self.client.post(f"{URL}/{self.thread.pk}:close")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class RecipientsTests(ThreadAPITestCase):
    def test_recipients_excludes_guardians_and_students(self) -> None:
        with tenant_context(self.tenant.id):
            colleague = UserFactory(tenant=self.tenant, first_name="Ayesha")
            grant(colleague, *STAFF_THREAD_KEYS)
            student_user = UserFactory(tenant=self.tenant)
            grant(student_user, *GUARDIAN_THREAD_KEYS, is_restricted_principal=True)
            inactive = UserFactory(tenant=self.tenant, is_active=False)
            grant(inactive, *STAFF_THREAD_KEYS)

        response = self.client.get(f"{URL}/recipients")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        ids = [row["user_id"] for row in response.data["data"]]
        self.assertEqual(ids, [str(colleague.pk)])
        self.assertEqual(response.data["data"][0]["name"], colleague.get_full_name())
        self.assertEqual(response.data["data"][0]["role"], "Test role")

    def test_recipients_search_narrows_by_name(self) -> None:
        with tenant_context(self.tenant.id):
            match = UserFactory(tenant=self.tenant, first_name="Zainab")
            grant(match, *STAFF_THREAD_KEYS)
            other = UserFactory(tenant=self.tenant, first_name="Bilal")
            grant(other, *STAFF_THREAD_KEYS)

        response = self.client.get(f"{URL}/recipients", {"search": "zain"})

        self.assertEqual([row["user_id"] for row in response.data["data"]], [str(match.pk)])

    def test_recipients_is_staff_only(self) -> None:
        authenticate(self.client, self.guardian_user)

        response = self.client.get(f"{URL}/recipients")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
