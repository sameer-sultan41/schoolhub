"""`/message-thread-oversight` — read-only, audited access to every thread."""

from __future__ import annotations

from rest_framework import status

from apps.communication.models import Message, MessageThread, ThreadStatus
from apps.communication.tests.factories import MessageFactory, UserFactory, authenticate, grant
from apps.communication.threads.tests.base import (
    GUARDIAN_THREAD_KEYS,
    STAFF_THREAD_KEYS,
    ThreadAPITestCase,
)
from core.audit.models import AuditLog
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

URL = "/api/v1/message-thread-oversight"


class ThreadOversightTests(ThreadAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.alice = UserFactory(tenant=self.tenant)
            self.bob = UserFactory(tenant=self.tenant)
            self.carol = UserFactory(tenant=self.tenant)
        # `self.user` holds every key (oversee included) but is in none of these.
        self.first = self.make_thread(self.alice, self.bob)
        self.second = self.make_thread(self.bob, self.carol, status=ThreadStatus.CLOSED)

    def listed_ids(self, response) -> set[str]:
        return {row["id"] for row in response.data["data"]}

    def test_principal_lists_all_threads(self) -> None:
        response = self.client.get(URL)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(self.listed_ids(response), {str(self.first.pk), str(self.second.pk)})
        self.assertNotIn("unread_count", response.data["data"][0])

    def test_list_filters_by_status(self) -> None:
        response = self.client.get(URL, {"status": ThreadStatus.CLOSED})

        self.assertEqual(self.listed_ids(response), {str(self.second.pk)})

    def test_list_filters_by_assigned_to(self) -> None:
        with tenant_context(self.tenant.id):
            MessageThread.objects.filter(pk=self.first.pk).update(assigned_to_id=self.carol.pk)

        response = self.client.get(URL, {"assigned_to": str(self.carol.pk)})

        self.assertEqual(self.listed_ids(response), {str(self.first.pk)})

    def test_teacher_without_oversee_is_403(self) -> None:
        with tenant_context(self.tenant.id):
            teacher = UserFactory(tenant=self.tenant)
            grant(teacher, *STAFF_THREAD_KEYS, scope=RecordScope.ASSIGNED)
        authenticate(self.client, teacher)

        for url in (URL, f"{URL}/{self.first.pk}", f"{URL}/{self.first.pk}/messages"):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, status.HTTP_403_FORBIDDEN)

    def test_guardian_is_403(self) -> None:
        # Even holding the key, a restricted principal never reaches staff oversight.
        with tenant_context(self.tenant.id):
            grant(
                self.guardian_user,
                *GUARDIAN_THREAD_KEYS,
                "communication.thread.oversee",
                scope=RecordScope.OWN,
                is_restricted_principal=True,
            )
        authenticate(self.client, self.guardian_user)

        self.assertEqual(self.client.get(URL).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(
            self.client.get(f"{URL}/{self.first.pk}").status_code, status.HTTP_403_FORBIDDEN
        )

    def test_oversight_retrieve_writes_audit_row(self) -> None:
        response = self.client.get(f"{URL}/{self.first.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["data"]["id"], str(self.first.pk))
        row = AuditLog.objects.get(action="oversight_view", resource_id=self.first.pk)
        self.assertEqual(row.actor_id, self.user.pk)
        self.assertEqual(row.tenant_id, self.tenant.pk)

    def test_oversight_messages_include_internal_notes_and_write_audit_row(self) -> None:
        with tenant_context(self.tenant.id):
            MessageFactory(
                thread=self.first, sender_id=self.alice.pk, body="Note", is_internal_note=True
            )

        response = self.client.get(f"{URL}/{self.first.pk}/messages")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertIn(True, [row["is_internal_note"] for row in response.data["data"]])
        self.assertTrue(
            AuditLog.objects.filter(
                action="oversight_view_messages", resource_id=self.first.pk
            ).exists()
        )

    def test_oversight_does_not_change_read_by(self) -> None:
        self.client.get(f"{URL}/{self.first.pk}")
        self.client.get(f"{URL}/{self.first.pk}/messages")

        with tenant_context(self.tenant.id):
            messages = Message.objects.filter(thread=self.first)
            stamps = list(messages.values_list("read_by", flat=True))
        self.assertTrue(stamps)
        for read_by in stamps:
            self.assertFalse(read_by)
            self.assertNotIn(str(self.user.pk), read_by or {})

    def test_oversight_is_read_only(self) -> None:
        response = self.client.post(f"{URL}/{self.first.pk}/messages", {"body": "x"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
