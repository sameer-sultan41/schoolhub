"""Notices — the draft -> pending_approval -> published workflow, numbering, and acknowledgment."""

from __future__ import annotations

from apps.communication.models import AudienceType, NoticeStatus
from apps.communication.notices.services.acknowledge import acknowledge_notice
from apps.communication.notices.services.publish import publish_notice
from apps.communication.notices.services.return_to_draft import return_notice_to_draft
from apps.communication.notices.services.submit import submit_notice
from apps.communication.tests.base import CommunicationAPITestCase
from apps.communication.tests.factories import NoticeFactory, UserFactory
from core.api.exceptions import DomainRuleViolation
from core.notifications.models import Notification
from core.tenancy.context import tenant_context


class NoticeWorkflowTests(CommunicationAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.recipient = UserFactory(tenant=self.tenant)
            self.approver = UserFactory(tenant=self.tenant)

    def _draft_and_submit(self, **kwargs):
        with tenant_context(self.tenant.id):
            notice = NoticeFactory(
                tenant=self.tenant,
                created_by=self.user.pk,
                audience_type=AudienceType.CUSTOM,
                audience_filter={"user_ids": [str(self.recipient.pk)]},
                **kwargs,
            )
            return submit_notice(notice, actor_id=self.user.pk)

    def test_notice_numbers_are_gapless_across_a_batch(self) -> None:
        with tenant_context(self.tenant.id):
            first = self._draft_and_submit()
            second = self._draft_and_submit()
            published_first = publish_notice(first, actor_id=self.approver.pk)
            published_second = publish_notice(second, actor_id=self.approver.pk)

        self.assertNotEqual(published_first.notice_no, published_second.notice_no)
        first_seq = int(published_first.notice_no.rsplit("-", 1)[1])
        second_seq = int(published_second.notice_no.rsplit("-", 1)[1])
        self.assertEqual(second_seq, first_seq + 1)

    def test_the_approver_cannot_be_the_drafts_own_creator(self) -> None:
        with tenant_context(self.tenant.id):
            notice = self._draft_and_submit()
            with self.assertRaises(DomainRuleViolation):
                publish_notice(notice, actor_id=self.user.pk)

    def test_publish_without_prior_approval_is_refused(self) -> None:
        with tenant_context(self.tenant.id):
            notice = NoticeFactory(
                tenant=self.tenant,
                created_by=self.user.pk,
                audience_type=AudienceType.CUSTOM,
                audience_filter={"user_ids": [str(self.recipient.pk)]},
            )
            with self.assertRaises(DomainRuleViolation):
                publish_notice(notice, actor_id=self.approver.pk)

    def test_returned_with_comments_goes_back_to_draft_not_to_pending_approval(self) -> None:
        with tenant_context(self.tenant.id):
            notice = self._draft_and_submit()
            returned = return_notice_to_draft(notice, actor_id=self.approver.pk)

        self.assertEqual(returned.status, NoticeStatus.DRAFT)

    def test_acknowledging_a_draft_notice_is_refused(self) -> None:
        with tenant_context(self.tenant.id):
            notice = NoticeFactory(
                tenant=self.tenant,
                created_by=self.user.pk,
                requires_acknowledgment=True,
                audience_type=AudienceType.CUSTOM,
                audience_filter={"user_ids": [str(self.recipient.pk)]},
            )
            with self.assertRaises(DomainRuleViolation):
                acknowledge_notice(notice, actor_id=self.recipient.pk)

    def test_acknowledging_a_notice_that_does_not_require_it_is_refused(self) -> None:
        with tenant_context(self.tenant.id):
            notice = self._draft_and_submit(requires_acknowledgment=False)
            published = publish_notice(notice, actor_id=self.approver.pk)
            with self.assertRaises(DomainRuleViolation):
                acknowledge_notice(published, actor_id=self.recipient.pk)

    def test_acknowledging_twice_is_idempotent_not_an_error(self) -> None:
        with tenant_context(self.tenant.id), self.captureOnCommitCallbacks(execute=True):
            notice = self._draft_and_submit(requires_acknowledgment=True)
            published = publish_notice(notice, actor_id=self.approver.pk)

        with tenant_context(self.tenant.id):
            acknowledge_notice(published, actor_id=self.recipient.pk)
            acknowledge_notice(published, actor_id=self.recipient.pk)  # no-op, no raise

            notification = Notification.objects.get(
                source_type="notice", source_id=published.pk, user_id=self.recipient.pk
            )
        self.assertIsNotNone(notification.acknowledged_at)

    def test_acknowledgment_is_recorded_on_the_recipients_notification_row(self) -> None:
        with tenant_context(self.tenant.id), self.captureOnCommitCallbacks(execute=True):
            notice = self._draft_and_submit(requires_acknowledgment=True)
            published = publish_notice(notice, actor_id=self.approver.pk)

        with tenant_context(self.tenant.id):
            self.assertTrue(
                Notification.objects.filter(
                    source_type="notice",
                    source_id=published.pk,
                    user_id=self.recipient.pk,
                    acknowledged_at__isnull=True,
                ).exists()
            )
            acknowledge_notice(published, actor_id=self.recipient.pk)
            self.assertFalse(
                Notification.objects.filter(
                    source_type="notice",
                    source_id=published.pk,
                    user_id=self.recipient.pk,
                    acknowledged_at__isnull=True,
                ).exists()
            )
