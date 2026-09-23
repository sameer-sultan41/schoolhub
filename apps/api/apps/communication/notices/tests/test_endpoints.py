"""Notices — HTTP endpoint round trips."""

from __future__ import annotations

from rest_framework import status

from apps.communication.models import AudienceType, NoticeStatus
from apps.communication.notices.services.publish import publish_notice
from apps.communication.tests.base import CommunicationAPITestCase
from apps.communication.tests.factories import NoticeFactory, UserFactory, authenticate, grant
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context


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

    def test_returning_a_notice_via_the_endpoint_sends_it_back_to_draft(self) -> None:
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
        self.client.post(f"/api/v1/notices/{notice_id}:submit")

        authenticate(self.client, approver)
        response = self.client.post(f"/api/v1/notices/{notice_id}:return-to-draft")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["data"]["status"], NoticeStatus.DRAFT)

    def test_editing_a_pending_approval_notice_is_refused(self) -> None:
        with tenant_context(self.tenant.id):
            recipient = UserFactory(tenant=self.tenant)

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
        notice_id = response.data["id"]
        self.client.post(f"/api/v1/notices/{notice_id}:submit")

        response = self.client.patch(
            f"/api/v1/notices/{notice_id}", {"title": "Changed"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, response.data)

    def test_editing_a_published_notice_is_refused(self) -> None:
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
        notice_id = response.data["id"]
        self.client.post(f"/api/v1/notices/{notice_id}:submit")

        authenticate(self.client, approver)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(f"/api/v1/notices/{notice_id}:publish")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

        authenticate(self.client, self.user)
        response = self.client.patch(
            f"/api/v1/notices/{notice_id}", {"title": "Changed"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, response.data)

    def test_a_recipient_can_acknowledge_a_notice_via_the_endpoint(self) -> None:
        with tenant_context(self.tenant.id):
            guardian = UserFactory(tenant=self.tenant)
            grant(
                guardian,
                "communication.notice.acknowledge",
                scope=RecordScope.OWN,
                is_restricted_principal=True,
            )
            approver = UserFactory(tenant=self.tenant)
            grant(approver, "communication.notice.publish")

        with tenant_context(self.tenant.id), self.captureOnCommitCallbacks(execute=True):
            notice = NoticeFactory(
                tenant=self.tenant,
                created_by=self.user.pk,
                status=NoticeStatus.PENDING_APPROVAL,
                audience_type=AudienceType.CUSTOM,
                audience_filter={"user_ids": [str(guardian.pk)]},
                requires_acknowledgment=True,
            )
            published = publish_notice(notice, actor_id=approver.pk)

        authenticate(self.client, guardian)
        response = self.client.post(f"/api/v1/notices/{published.pk}:acknowledge")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

    def test_a_non_recipient_acknowledging_a_notice_via_the_endpoint_is_404(self) -> None:
        with tenant_context(self.tenant.id):
            guardian = UserFactory(tenant=self.tenant)
            grant(
                guardian,
                "communication.notice.acknowledge",
                scope=RecordScope.OWN,
                is_restricted_principal=True,
            )
            other_recipient = UserFactory(tenant=self.tenant)
            approver = UserFactory(tenant=self.tenant)
            grant(approver, "communication.notice.publish")

        with tenant_context(self.tenant.id), self.captureOnCommitCallbacks(execute=True):
            notice = NoticeFactory(
                tenant=self.tenant,
                created_by=self.user.pk,
                status=NoticeStatus.PENDING_APPROVAL,
                audience_type=AudienceType.CUSTOM,
                audience_filter={"user_ids": [str(other_recipient.pk)]},
                requires_acknowledgment=True,
            )
            published = publish_notice(notice, actor_id=approver.pk)

        authenticate(self.client, guardian)
        response = self.client.post(f"/api/v1/notices/{published.pk}:acknowledge")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
