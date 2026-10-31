"""Message threads — participant scoping and the append-only message table."""

from __future__ import annotations

from django.test import TestCase

from apps.communication.models import Message, MessageThread
from apps.communication.tests.factories import (
    MessageFactory,
    MessageThreadFactory,
    TenantFactory,
    UserFactory,
)
from core.tenancy.context import tenant_context


class MessageThreadModelTests(TestCase):
    def setUp(self) -> None:
        self.tenant = TenantFactory()
        with tenant_context(self.tenant.id):
            self.member = UserFactory(tenant=self.tenant)
            self.outsider = UserFactory(tenant=self.tenant)

    def test_participant_filter_returns_only_participant_threads(self) -> None:
        with tenant_context(self.tenant.id):
            mine = MessageThreadFactory(
                tenant=self.tenant, participant_user_ids=[str(self.member.pk)]
            )
            MessageThreadFactory(tenant=self.tenant, participant_user_ids=[str(self.outsider.pk)])
            MessageThreadFactory(tenant=self.tenant, participant_user_ids=[])

            found = MessageThread.participant_filter(MessageThread.objects.all(), self.member)

            self.assertEqual(list(found), [mine])

    def test_owned_and_assigned_scopes_both_delegate_to_the_participant_filter(self) -> None:
        with tenant_context(self.tenant.id):
            mine = MessageThreadFactory(
                tenant=self.tenant, participant_user_ids=[str(self.member.pk)]
            )
            MessageThreadFactory(tenant=self.tenant, participant_user_ids=[str(self.outsider.pk)])
            queryset = MessageThread.objects.all()

            self.assertEqual(
                list(MessageThread.filter_owned_by_user(queryset, self.member)), [mine]
            )
            self.assertEqual(
                list(MessageThread.filter_assigned_to_user(queryset, self.member)), [mine]
            )

    def test_is_participant_matches_on_the_stringified_user_id(self) -> None:
        thread = MessageThreadFactory.build(participant_user_ids=[str(self.member.pk)])

        self.assertTrue(thread.is_participant(self.member.pk))
        self.assertFalse(thread.is_participant(self.outsider.pk))


class MessageAppendOnlyTests(TestCase):
    """Layers 1 and 2 of the append-only guard; the grant (layer 3) is asserted
    for every table at once by `tests/test_append_only_coverage.py`."""

    def setUp(self) -> None:
        self.tenant = TenantFactory()
        with tenant_context(self.tenant.id):
            thread = MessageThreadFactory(tenant=self.tenant)
            self.message = MessageFactory(thread=thread)

    def test_message_body_update_is_refused(self) -> None:
        with tenant_context(self.tenant.id):
            self.message.body = "edited after sending"

            with self.assertRaises(RuntimeError) as caught:
                self.message.save()

            self.assertIn("append-only", str(caught.exception))

    def test_message_save_outside_the_mutable_fields_is_refused(self) -> None:
        with tenant_context(self.tenant.id):
            self.message.body = "edited after sending"

            with self.assertRaises(RuntimeError):
                self.message.save(update_fields=["body"])

    def test_read_receipts_are_the_one_field_that_can_be_stamped(self) -> None:
        with tenant_context(self.tenant.id):
            self.message.read_by = {"someone": "2026-10-31T10:00:00+00:00"}
            self.message.save(update_fields=["read_by"])

            self.message.refresh_from_db()

            self.assertEqual(self.message.read_by, {"someone": "2026-10-31T10:00:00+00:00"})

    def test_message_queryset_update_is_refused(self) -> None:
        with tenant_context(self.tenant.id), self.assertRaises(RuntimeError):
            Message.objects.update(body="rewritten")

    def test_message_delete_is_refused(self) -> None:
        with tenant_context(self.tenant.id), self.assertRaises(RuntimeError):
            self.message.delete()
