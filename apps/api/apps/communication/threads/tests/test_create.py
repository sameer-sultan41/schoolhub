"""Starting a thread — guardian routing and who may start which thread, with whom."""

from __future__ import annotations

from rest_framework import status

from apps.communication.models import Message, MessageThread, ThreadType
from apps.communication.tests.factories import (
    StudentFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.communication.threads.routing import THREAD_FALLBACK_ROLE_DEFAULT
from apps.communication.threads.tests.base import (
    GUARDIAN_THREAD_KEYS,
    STAFF_THREAD_KEYS,
    ThreadAPITestCase,
)
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

URL = "/api/v1/message-threads"


class ThreadCreateTestCase(ThreadAPITestCase):
    def guardian_thread(self, **overrides):
        payload = {
            "subject": "About homework",
            "thread_type": ThreadType.GUARDIAN_SCHOOL,
            "student_id": str(self.student.pk),
            "body": "Could you share this week's homework?",
            **overrides,
        }
        return self.client.post(URL, payload, format="json")

    def stored_thread(self, response) -> MessageThread:
        with tenant_context(self.tenant.id):
            return MessageThread.objects.get(pk=response.data["data"]["id"])


class GuardianRoutingTests(ThreadCreateTestCase):
    def setUp(self) -> None:
        super().setUp()
        authenticate(self.client, self.guardian_user)

    def test_guardian_thread_routes_to_class_teacher_and_assigns_them(self) -> None:
        teacher = self.make_class_teacher()
        self.make_staff_with_role(THREAD_FALLBACK_ROLE_DEFAULT)

        response = self.guardian_thread()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        thread = self.stored_thread(response)
        self.assertEqual(thread.participant_user_ids, [str(self.guardian_user.pk), str(teacher.pk)])
        self.assertEqual(thread.assigned_to_id, teacher.pk)
        self.assertEqual(response.data["data"]["unread_count"], 0)
        with tenant_context(self.tenant.id):
            opening = Message.objects.get(thread=thread)
        self.assertEqual(opening.sender_id, self.guardian_user.pk)
        self.assertEqual(thread.last_message_at, opening.sent_at)

    def test_guardian_thread_falls_back_to_configured_role(self) -> None:
        self.set_fallback_role("reception")
        reception = self.make_staff_with_role("reception")
        admin = self.make_staff_with_role(THREAD_FALLBACK_ROLE_DEFAULT)

        response = self.guardian_thread()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        thread = self.stored_thread(response)
        self.assertIn(str(reception.pk), thread.participant_user_ids)
        self.assertNotIn(str(admin.pk), thread.participant_user_ids)
        self.assertIsNone(thread.assigned_to_id)

    def test_unknown_fallback_role_uses_default(self) -> None:
        self.set_fallback_role("no-such-role")
        admin = self.make_staff_with_role(THREAD_FALLBACK_ROLE_DEFAULT)

        with self.assertLogs("apps.communication.threads.routing", level="WARNING"):
            response = self.guardian_thread()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertIn(str(admin.pk), self.stored_thread(response).participant_user_ids)

    def test_departed_class_teacher_falls_back(self) -> None:
        teacher = self.make_class_teacher()
        with tenant_context(self.tenant.id):
            teacher.is_active = False
            teacher.save(update_fields=["is_active"])
        admin = self.make_staff_with_role(THREAD_FALLBACK_ROLE_DEFAULT)

        response = self.guardian_thread()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        thread = self.stored_thread(response)
        self.assertNotIn(str(teacher.pk), thread.participant_user_ids)
        self.assertIn(str(admin.pk), thread.participant_user_ids)

    def test_no_routable_staff_is_422(self) -> None:
        response = self.guardian_thread()

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(
            response.data["error"]["message"], "No staff member can receive this thread."
        )
        with tenant_context(self.tenant.id):
            self.assertFalse(MessageThread.objects.exists())

    def test_guardian_thread_for_unlinked_student_is_404(self) -> None:
        self.make_class_teacher()
        with tenant_context(self.tenant.id):
            someone_elses_child = StudentFactory(tenant=self.tenant, campus=self.campus)

        response = self.guardian_thread(student_id=str(someone_elses_child.pk))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_guardian_with_revoked_portal_access_cannot_start_a_thread(self) -> None:
        self.make_class_teacher()
        with tenant_context(self.tenant.id):
            self.guardian_link.has_portal_access = False
            self.guardian_link.save(update_fields=["has_portal_access"])

        response = self.guardian_thread()

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_guardian_cannot_create_internal_thread_422(self) -> None:
        with tenant_context(self.tenant.id):
            colleague = UserFactory(tenant=self.tenant)
            grant(colleague, *STAFF_THREAD_KEYS)

        response = self.client.post(
            URL,
            {
                "subject": "Hello",
                "thread_type": ThreadType.INTERNAL,
                "participant_user_ids": [str(colleague.pk)],
                "body": "Hi.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        with tenant_context(self.tenant.id):
            self.assertFalse(MessageThread.objects.exists())


class StaffGuardianThreadTests(ThreadCreateTestCase):
    def test_staff_guardian_thread_out_of_scope_student_is_404(self) -> None:
        with tenant_context(self.tenant.id):
            teacher = UserFactory(tenant=self.tenant)
            # `assigned`, but not this student's class teacher.
            grant(teacher, *STAFF_THREAD_KEYS, scope=RecordScope.ASSIGNED)
        authenticate(self.client, teacher)

        response = self.guardian_thread()

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_staff_guardian_thread_skips_guardians_without_portal_or_comms(self) -> None:
        with tenant_context(self.tenant.id):
            no_portal = UserFactory(tenant=self.tenant)
            opted_out = UserFactory(tenant=self.tenant)
        self.link_guardian(no_portal, has_portal_access=False)
        self.link_guardian(opted_out, receives_communications=False)

        response = self.guardian_thread()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        thread = self.stored_thread(response)
        self.assertEqual(
            thread.participant_user_ids, [str(self.user.pk), str(self.guardian_user.pk)]
        )
        self.assertEqual(thread.assigned_to_id, self.user.pk)

    def test_staff_guardian_thread_with_no_reachable_guardian_is_422(self) -> None:
        with tenant_context(self.tenant.id):
            self.guardian_link.receives_communications = False
            self.guardian_link.save(update_fields=["receives_communications"])

        response = self.guardian_thread()

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)


class StaffInternalThreadTests(ThreadCreateTestCase):
    def internal_thread(self, thread_type, *participants):
        return self.client.post(
            URL,
            {
                "subject": "Timetable change",
                "thread_type": thread_type,
                "participant_user_ids": [str(user.pk) for user in participants],
                "body": "Can we swap periods on Monday?",
            },
            format="json",
        )

    def colleague(self):
        with tenant_context(self.tenant.id):
            user = UserFactory(tenant=self.tenant)
            grant(user, *STAFF_THREAD_KEYS)
        return user

    def test_internal_thread_with_one_colleague(self) -> None:
        colleague = self.colleague()

        response = self.internal_thread(ThreadType.INTERNAL, colleague)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(
            self.stored_thread(response).participant_user_ids,
            [str(self.user.pk), str(colleague.pk)],
        )

    def test_internal_thread_with_two_colleagues_is_422(self) -> None:
        response = self.internal_thread(ThreadType.INTERNAL, self.colleague(), self.colleague())

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_group_thread_needs_two_colleagues(self) -> None:
        response = self.internal_thread(ThreadType.GROUP, self.colleague())
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

        response = self.internal_thread(ThreadType.GROUP, self.colleague(), self.colleague())
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

    def test_internal_thread_with_foreign_tenant_user_is_404(self) -> None:
        other_tenant = TenantFactory()
        with tenant_context(other_tenant.id):
            foreigner = UserFactory(tenant=other_tenant)
            grant(foreigner, *STAFF_THREAD_KEYS)

        response = self.internal_thread(ThreadType.INTERNAL, foreigner)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        with tenant_context(self.tenant.id):
            self.assertFalse(MessageThread.objects.exists())

    def test_internal_thread_with_a_guardian_is_404(self) -> None:
        response = self.internal_thread(ThreadType.INTERNAL, self.guardian_user)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_internal_thread_with_an_inactive_colleague_is_404(self) -> None:
        colleague = self.colleague()
        with tenant_context(self.tenant.id):
            colleague.is_active = False
            colleague.save(update_fields=["is_active"])

        response = self.internal_thread(ThreadType.INTERNAL, colleague)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class CreateWithoutKeyTests(ThreadCreateTestCase):
    def test_creating_without_thread_create_is_403(self) -> None:
        with tenant_context(self.tenant.id):
            reader = UserFactory(tenant=self.tenant)
            grant(reader, GUARDIAN_THREAD_KEYS[0])
        authenticate(self.client, reader)

        response = self.guardian_thread()

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
