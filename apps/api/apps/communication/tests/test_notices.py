"""Notices — the draft -> pending_approval -> published workflow, numbering, and acknowledgment."""

from __future__ import annotations

from rest_framework import status

from apps.communication import services
from apps.communication.models import AudienceType, NoticeStatus
from apps.communication.tests.base import CommunicationAPITestCase
from apps.communication.tests.factories import NoticeFactory, UserFactory, authenticate, grant
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
            return services.submit_notice(notice, actor_id=self.user.pk)

    def test_notice_numbers_are_gapless_across_a_batch(self) -> None:
        with tenant_context(self.tenant.id):
            first = self._draft_and_submit()
            second = self._draft_and_submit()
            published_first = services.publish_notice(first, actor_id=self.approver.pk)
            published_second = services.publish_notice(second, actor_id=self.approver.pk)

        self.assertNotEqual(published_first.notice_no, published_second.notice_no)
        first_seq = int(published_first.notice_no.rsplit("-", 1)[1])
        second_seq = int(published_second.notice_no.rsplit("-", 1)[1])
        self.assertEqual(second_seq, first_seq + 1)

    def test_the_approver_cannot_be_the_drafts_own_creator(self) -> None:
        with tenant_context(self.tenant.id):
            notice = self._draft_and_submit()
            with self.assertRaises(DomainRuleViolation):
                services.publish_notice(notice, actor_id=self.user.pk)

    def test_publish_without_prior_approval_is_refused(self) -> None:
        with tenant_context(self.tenant.id):
            notice = NoticeFactory(
                tenant=self.tenant,
                created_by=self.user.pk,
                audience_type=AudienceType.CUSTOM,
                audience_filter={"user_ids": [str(self.recipient.pk)]},
            )
            with self.assertRaises(DomainRuleViolation):
                services.publish_notice(notice, actor_id=self.approver.pk)

    def test_returned_with_comments_goes_back_to_draft_not_to_pending_approval(self) -> None:
        with tenant_context(self.tenant.id):
            notice = self._draft_and_submit()
            returned = services.return_notice_to_draft(notice, actor_id=self.approver.pk)

        self.assertEqual(returned.status, NoticeStatus.DRAFT)

    def test_acknowledging_a_notice_that_does_not_require_it_is_refused(self) -> None:
        with tenant_context(self.tenant.id):
            notice = self._draft_and_submit(requires_acknowledgment=False)
            published = services.publish_notice(notice, actor_id=self.approver.pk)
            with self.assertRaises(DomainRuleViolation):
                services.acknowledge_notice(published, actor_id=self.recipient.pk)

    def test_acknowledging_twice_is_idempotent_not_an_error(self) -> None:
        with tenant_context(self.tenant.id), self.captureOnCommitCallbacks(execute=True):
            notice = self._draft_and_submit(requires_acknowledgment=True)
            published = services.publish_notice(notice, actor_id=self.approver.pk)

        with tenant_context(self.tenant.id):
            services.acknowledge_notice(published, actor_id=self.recipient.pk)
            services.acknowledge_notice(published, actor_id=self.recipient.pk)  # no-op, no raise

            notification = Notification.objects.get(
                source_type="notice", source_id=published.pk, user_id=self.recipient.pk
            )
        self.assertIsNotNone(notification.acknowledged_at)

    def test_acknowledgment_is_recorded_on_the_recipients_notification_row(self) -> None:
        with tenant_context(self.tenant.id), self.captureOnCommitCallbacks(execute=True):
            notice = self._draft_and_submit(requires_acknowledgment=True)
            published = services.publish_notice(notice, actor_id=self.approver.pk)

        with tenant_context(self.tenant.id):
            self.assertTrue(
                Notification.objects.filter(
                    source_type="notice",
                    source_id=published.pk,
                    user_id=self.recipient.pk,
                    acknowledged_at__isnull=True,
                ).exists()
            )
            services.acknowledge_notice(published, actor_id=self.recipient.pk)
            self.assertFalse(
                Notification.objects.filter(
                    source_type="notice",
                    source_id=published.pk,
                    user_id=self.recipient.pk,
                    acknowledged_at__isnull=True,
                ).exists()
            )


class NoticeEndpointTests(CommunicationAPITestCase):
    def test_draft_submit_publish_round_trip(self) -> None:
        with tenant_context(self.tenant.id):
            recipient = UserFactory(tenant=self.tenant)
            approver = UserFactory(tenant=self.tenant)
            grant(approver, "communication.notice.publish")

        response = self.client.post(
            "/api/v1/notices",
            {
                "title": "Exam schedule",
                "body": "Final exams begin next month.",
                "audience_type": AudienceType.CUSTOM,
                "audience_filter": {"user_ids": [str(recipient.pk)]},
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        notice_id = response.data["id"]

        response = self.client.post(f"/api/v1/notices/{notice_id}:submit")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["data"]["status"], NoticeStatus.PENDING_APPROVAL)

        authenticate(self.client, approver)
        response = self.client.post(f"/api/v1/notices/{notice_id}:publish")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["data"]["status"], NoticeStatus.PUBLISHED)
        self.assertIsNotNone(response.data["data"]["notice_no"])

    def test_downloading_a_notice_as_pdf(self) -> None:
        with tenant_context(self.tenant.id):
            notice = NoticeFactory(tenant=self.tenant, created_by=self.user.pk)

        response = self.client.get(f"/api/v1/notices/{notice.pk}/download")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "application/pdf")
