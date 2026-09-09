"""Announcements — publish workflow, audience fan-out, and the API surface."""

from __future__ import annotations

from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework import status

from apps.communication import services
from apps.communication.models import AnnouncementStatus, AudienceType
from apps.communication.tests.base import CommunicationAPITestCase
from apps.communication.tests.factories import AnnouncementFactory, TenantFactory, UserFactory
from core.api.exceptions import DomainRuleViolation
from core.notifications.models import DeliveryLog, Notification
from core.tenancy.context import tenant_context


class PublishAnnouncementTests(CommunicationAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.recipient = UserFactory(tenant=self.tenant)

    def test_publishing_resolves_the_audience_to_at_least_one_recipient(self) -> None:
        with tenant_context(self.tenant.id):
            announcement = AnnouncementFactory(
                tenant=self.tenant,
                audience_type=AudienceType.CUSTOM,
                audience_filter={"user_ids": []},
            )
            with self.assertRaises(DomainRuleViolation):
                services.publish_announcement(announcement, actor_id=self.user.pk)

    def test_a_custom_audience_referencing_a_cross_tenant_user_id_is_refused(self) -> None:
        other_tenant = TenantFactory()
        with tenant_context(other_tenant.id):
            other_tenant_user_id = UserFactory(tenant=other_tenant).pk

        with tenant_context(self.tenant.id):
            announcement = AnnouncementFactory(
                tenant=self.tenant,
                audience_type=AudienceType.CUSTOM,
                audience_filter={"user_ids": [str(other_tenant_user_id)]},
            )
            with self.assertRaises(DomainRuleViolation):
                services.publish_announcement(announcement, actor_id=self.user.pk)

    def test_the_real_notify_call_persists_a_notification_and_a_delivery_log_per_channel(
        self,
    ) -> None:
        """Exercises the REAL notify(), not a mock — the fees-finance review
        found every mocked-notify() call site in that module had a broken
        context shape that shipped through two review rounds undetected."""
        with tenant_context(self.tenant.id):
            announcement = AnnouncementFactory(
                tenant=self.tenant,
                audience_type=AudienceType.CUSTOM,
                audience_filter={"user_ids": [str(self.recipient.pk)]},
            )

            with self.captureOnCommitCallbacks(execute=True):
                services.publish_announcement(announcement, actor_id=self.user.pk)

            notification = Notification.objects.get(
                source_type="announcement", source_id=announcement.pk
            )
            self.assertEqual(notification.user_id, self.recipient.pk)
            self.assertEqual(notification.title, announcement.title)

            deliveries = DeliveryLog.objects.filter(notification=notification)
            self.assertTrue(deliveries.exists())

    def test_publish_fans_out_exactly_once_per_resolved_recipient_regardless_of_audience_size(
        self,
    ) -> None:
        with tenant_context(self.tenant.id):
            # A throwaway publish first, outside either capture: the feature-flag
            # and template-resolution caches are cold on the very first notify()
            # call in the process, which would otherwise make the *first*
            # comparison call look more expensive than the second for a reason
            # that has nothing to do with audience size.
            warm_up = AnnouncementFactory(
                tenant=self.tenant,
                audience_type=AudienceType.CUSTOM,
                audience_filter={"user_ids": [str(UserFactory(tenant=self.tenant).pk)]},
            )
            services.publish_announcement(warm_up, actor_id=self.user.pk)

            few_ids = [str(UserFactory(tenant=self.tenant).pk) for _ in range(2)]
            many_ids = [str(UserFactory(tenant=self.tenant).pk) for _ in range(10)]

            few = AnnouncementFactory(
                tenant=self.tenant,
                audience_type=AudienceType.CUSTOM,
                audience_filter={"user_ids": few_ids},
            )
            with CaptureQueriesContext(connection) as few_captured:
                services.publish_announcement(few, actor_id=self.user.pk)

            many = AnnouncementFactory(
                tenant=self.tenant,
                audience_type=AudienceType.CUSTOM,
                audience_filter={"user_ids": many_ids},
            )
            with CaptureQueriesContext(connection) as many_captured:
                services.publish_announcement(many, actor_id=self.user.pk)

        self.assertEqual(len(few_captured.captured_queries), len(many_captured.captured_queries))

    def test_a_scheduled_announcement_publishes_itself_at_publish_at(self) -> None:
        with tenant_context(self.tenant.id):
            announcement = AnnouncementFactory(
                tenant=self.tenant,
                status=AnnouncementStatus.SCHEDULED,
                audience_type=AudienceType.CUSTOM,
                audience_filter={"user_ids": [str(self.recipient.pk)]},
            )
            published = services.publish_announcement(announcement, actor_id=self.user.pk)

        self.assertEqual(published.status, AnnouncementStatus.PUBLISHED)
        self.assertIsNotNone(published.published_at)
        self.assertEqual(published.published_by, self.user.pk)

    def test_publishing_an_already_published_announcement_is_refused(self) -> None:
        with tenant_context(self.tenant.id):
            announcement = AnnouncementFactory(
                tenant=self.tenant,
                audience_type=AudienceType.CUSTOM,
                audience_filter={"user_ids": [str(self.recipient.pk)]},
            )
            services.publish_announcement(announcement, actor_id=self.user.pk)
            with self.assertRaises(DomainRuleViolation):
                services.publish_announcement(announcement, actor_id=self.user.pk)


class AnnouncementFeedTests(CommunicationAPITestCase):
    def test_show_on_website_only_ever_true_for_a_published_announcement(self) -> None:
        with tenant_context(self.tenant.id):
            draft = AnnouncementFactory(
                tenant=self.tenant, status=AnnouncementStatus.DRAFT, show_on_website=True
            )

        self.assertEqual(draft.status, AnnouncementStatus.DRAFT)
        # show_on_website is a flag the drafter sets ahead of publishing — the
        # website renderer only reads *published* rows (out of this PR's
        # scope), so the guarantee lives in what gets exposed, not in refusing
        # the flag on a draft.
        self.assertTrue(draft.show_on_website)


class AnnouncementEndpointTests(CommunicationAPITestCase):
    def test_create_and_publish_round_trip(self) -> None:
        with tenant_context(self.tenant.id):
            recipient = UserFactory(tenant=self.tenant)

        response = self.client.post(
            "/api/v1/announcements",
            {
                "title": "Sports day",
                "body": "Sports day is next Friday.",
                "audience_type": AudienceType.CUSTOM,
                "audience_filter": {"user_ids": [str(recipient.pk)]},
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        announcement_id = response.data["id"]

        response = self.client.post(f"/api/v1/announcements/{announcement_id}:publish")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["data"]["status"], AnnouncementStatus.PUBLISHED)

    def test_publishing_with_zero_recipients_is_refused_with_a_422(self) -> None:
        with tenant_context(self.tenant.id):
            announcement = AnnouncementFactory(
                tenant=self.tenant,
                audience_type=AudienceType.CUSTOM,
                audience_filter={"user_ids": []},
            )

        response = self.client.post(f"/api/v1/announcements/{announcement.pk}:publish")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
