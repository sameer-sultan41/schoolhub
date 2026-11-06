"""A guardian's or student's own reading of `/notices` — the portal-safe shape and reach."""

from __future__ import annotations

from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status

from apps.communication.models import AudienceType, Notice, NoticeStatus
from apps.communication.notices.services.publish import publish_notice
from apps.communication.tests.base import CommunicationAPITestCase
from apps.communication.tests.factories import (
    NoticeFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
)
from core.notifications.models import Notification
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

PORTAL_FIELDS = {
    "id",
    "notice_no",
    "title",
    "body",
    "notice_type",
    "published_at",
    "requires_acknowledgment",
    "acknowledged_at",
}


class PortalNoticeTests(CommunicationAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.guardian = UserFactory(tenant=self.tenant)
            grant(
                self.guardian,
                "communication.notice.view",
                "communication.notice.acknowledge",
                scope=RecordScope.OWN,
                is_restricted_principal=True,
            )
            self.approver = UserFactory(tenant=self.tenant)
            grant(self.approver, "communication.notice.view", "communication.notice.publish")

    def publish_to(self, *recipients, requires_acknowledgment: bool = False) -> Notice:
        """A notice published to exactly `recipients`, so each gets a delivery row."""
        with tenant_context(self.tenant.id), self.captureOnCommitCallbacks(execute=True):
            notice = NoticeFactory(
                tenant=self.tenant,
                created_by=self.user.pk,
                status=NoticeStatus.PENDING_APPROVAL,
                audience_type=AudienceType.CUSTOM,
                audience_filter={"user_ids": [str(user.pk) for user in recipients]},
                requires_acknowledgment=requires_acknowledgment,
            )
            return publish_notice(notice, actor_id=self.approver.pk)

    def listed_ids(self, params: dict | None = None) -> list[str]:
        response = self.client.get("/api/v1/notices", params or {})
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        return [row["id"] for row in response.data["data"]]

    def test_guardian_lists_only_received_notices(self) -> None:
        with tenant_context(self.tenant.id):
            stranger = UserFactory(tenant=self.tenant)
        received = self.publish_to(self.guardian)
        elsewhere = self.publish_to(stranger)
        authenticate(self.client, self.guardian)

        ids = self.listed_ids()

        self.assertEqual(ids, [str(received.pk)])
        self.assertNotIn(str(elsewhere.pk), ids)

    def test_guardian_never_sees_an_unpublished_notice(self) -> None:
        """Even a delivery row for a draft (a stray write) does not surface one."""
        with tenant_context(self.tenant.id):
            draft = NoticeFactory(tenant=self.tenant, created_by=self.user.pk)
            Notification.objects.create(
                tenant_id=self.tenant.pk,
                user_id=self.guardian.pk,
                event_key="communication.notice-published",
                title="Draft",
                body="Draft",
                source_type="notice",
                source_id=draft.pk,
            )
        authenticate(self.client, self.guardian)

        self.assertEqual(self.listed_ids(), [])
        response = self.client.get(f"/api/v1/notices/{draft.pk}")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_guardian_retrieves_a_received_notice_and_not_another(self) -> None:
        with tenant_context(self.tenant.id):
            stranger = UserFactory(tenant=self.tenant)
        received = self.publish_to(self.guardian)
        elsewhere = self.publish_to(stranger)
        authenticate(self.client, self.guardian)

        mine = self.client.get(f"/api/v1/notices/{received.pk}")
        theirs = self.client.get(f"/api/v1/notices/{elsewhere.pk}")

        self.assertEqual(mine.status_code, status.HTTP_200_OK, mine.data)
        self.assertEqual(theirs.status_code, status.HTTP_404_NOT_FOUND)

    def test_guardian_cannot_filter_on_hidden_fields(self) -> None:
        """`status` and `audience_type` are not in the portal shape, so they filter nothing."""
        self.publish_to(self.guardian)
        self.publish_to(self.guardian, requires_acknowledgment=True)
        authenticate(self.client, self.guardian)
        unfiltered = self.listed_ids()

        # Every received notice is a published `custom` one, so a staff filter would empty these.
        by_audience = self.listed_ids({"audience_type": AudienceType.ALL})
        by_status = self.listed_ids({"status": NoticeStatus.DRAFT})

        self.assertEqual(len(unfiltered), 2)
        self.assertEqual(sorted(by_audience), sorted(unfiltered))
        self.assertEqual(sorted(by_status), sorted(unfiltered))

    def test_guardian_still_filters_on_portal_fields(self) -> None:
        self.publish_to(self.guardian)
        needs_ack = self.publish_to(self.guardian, requires_acknowledgment=True)
        authenticate(self.client, self.guardian)

        ids = self.listed_ids({"requires_acknowledgment": "true"})

        self.assertEqual(ids, [str(needs_ack.pk)])

    def test_soft_deleted_delivery_no_longer_grants_the_notice(self) -> None:
        received = self.publish_to(self.guardian)
        with tenant_context(self.tenant.id):
            Notification.objects.filter(
                user_id=self.guardian.pk, source_type="notice", source_id=received.pk
            ).update(deleted_at=timezone.now())
        authenticate(self.client, self.guardian)

        response = self.client.get(f"/api/v1/notices/{received.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.listed_ids(), [])

    def test_portal_notice_omits_audience_and_approver(self) -> None:
        received = self.publish_to(self.guardian)
        authenticate(self.client, self.guardian)

        row = self.client.get(f"/api/v1/notices/{received.pk}").data
        listed = self.client.get("/api/v1/notices").data["data"][0]

        self.assertEqual(set(row), PORTAL_FIELDS)
        self.assertEqual(set(listed), PORTAL_FIELDS)
        for leaked in ("audience_filter", "approved_by", "status", "show_on_website"):
            self.assertNotIn(leaked, row)

    def test_staff_still_get_the_full_notice_shape(self) -> None:
        notice = self.publish_to(self.guardian)

        row = self.client.get(f"/api/v1/notices/{notice.pk}").data

        self.assertIn("audience_filter", row)
        self.assertIn("approved_by", row)

    def test_guardian_cannot_create_or_publish_notice(self) -> None:
        with tenant_context(self.tenant.id):
            draft = NoticeFactory(tenant=self.tenant, created_by=self.user.pk)
        authenticate(self.client, self.guardian)

        created = self.client.post("/api/v1/notices", {"title": "T", "body": "B"}, format="json")
        submitted = self.client.post(f"/api/v1/notices/{draft.pk}:submit")
        published = self.client.post(f"/api/v1/notices/{draft.pk}:publish")
        edited = self.client.patch(f"/api/v1/notices/{draft.pk}", {"title": "X"}, format="json")

        for response in (created, submitted, published, edited):
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN, response.data)

    def test_notice_list_carries_own_acknowledged_at(self) -> None:
        acknowledged = self.publish_to(self.guardian, requires_acknowledgment=True)
        pending = self.publish_to(self.guardian, requires_acknowledgment=True)
        authenticate(self.client, self.guardian)
        self.client.post(f"/api/v1/notices/{acknowledged.pk}:acknowledge")

        rows = {row["id"]: row for row in self.client.get("/api/v1/notices").data["data"]}

        self.assertIsNotNone(rows[str(acknowledged.pk)]["acknowledged_at"])
        self.assertIsNone(rows[str(pending.pk)]["acknowledged_at"])

    def test_acknowledged_at_is_the_callers_own_not_a_co_recipients(self) -> None:
        with tenant_context(self.tenant.id):
            sibling = UserFactory(tenant=self.tenant)
        notice = self.publish_to(self.guardian, sibling, requires_acknowledgment=True)
        authenticate(self.client, sibling)
        self.client.post(f"/api/v1/notices/{notice.pk}:acknowledge")

        authenticate(self.client, self.guardian)
        row = self.client.get(f"/api/v1/notices/{notice.pk}").data

        self.assertIsNone(row["acknowledged_at"])

    def test_notice_list_query_count_does_not_grow_with_rows(self) -> None:
        self.publish_to(self.guardian, requires_acknowledgment=True)
        authenticate(self.client, self.guardian)
        self.client.get("/api/v1/notices")  # warm the permission caches
        with CaptureQueriesContext(connection) as one:
            self.client.get("/api/v1/notices")

        for _ in range(3):
            self.publish_to(self.guardian, requires_acknowledgment=True)
        authenticate(self.client, self.guardian)
        self.client.get("/api/v1/notices")
        with CaptureQueriesContext(connection) as many:
            self.client.get("/api/v1/notices")

        self.assertEqual(len(many), len(one))

    def test_guardian_retrieving_another_tenants_notice_is_404(self) -> None:
        other = TenantFactory()
        with tenant_context(other.id):
            foreign = NoticeFactory(tenant=other, status=NoticeStatus.PUBLISHED)
        authenticate(self.client, self.guardian)

        response = self.client.get(f"/api/v1/notices/{foreign.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
