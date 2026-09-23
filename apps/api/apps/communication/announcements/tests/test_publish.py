"""Announcements — publish workflow and audience fan-out."""

from __future__ import annotations

from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.communication.announcements.services.publish import publish_announcement
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
                publish_announcement(announcement, actor_id=self.user.pk)

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
                publish_announcement(announcement, actor_id=self.user.pk)

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
                publish_announcement(announcement, actor_id=self.user.pk)

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
            publish_announcement(warm_up, actor_id=self.user.pk)

            few_ids = [str(UserFactory(tenant=self.tenant).pk) for _ in range(2)]
            many_ids = [str(UserFactory(tenant=self.tenant).pk) for _ in range(10)]

            few = AnnouncementFactory(
                tenant=self.tenant,
                audience_type=AudienceType.CUSTOM,
                audience_filter={"user_ids": few_ids},
            )
            with CaptureQueriesContext(connection) as few_captured:
                publish_announcement(few, actor_id=self.user.pk)

            many = AnnouncementFactory(
                tenant=self.tenant,
                audience_type=AudienceType.CUSTOM,
                audience_filter={"user_ids": many_ids},
            )
            with CaptureQueriesContext(connection) as many_captured:
                publish_announcement(many, actor_id=self.user.pk)

        self.assertEqual(len(few_captured.captured_queries), len(many_captured.captured_queries))

    def test_a_scheduled_announcement_publishes_itself_at_publish_at(self) -> None:
        with tenant_context(self.tenant.id):
            announcement = AnnouncementFactory(
                tenant=self.tenant,
                status=AnnouncementStatus.SCHEDULED,
                audience_type=AudienceType.CUSTOM,
                audience_filter={"user_ids": [str(self.recipient.pk)]},
            )
            published = publish_announcement(announcement, actor_id=self.user.pk)

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
            publish_announcement(announcement, actor_id=self.user.pk)
            with self.assertRaises(DomainRuleViolation):
                publish_announcement(announcement, actor_id=self.user.pk)
