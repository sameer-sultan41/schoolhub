"""`send_emergency_broadcast_task` — the fan-out, its lane and its failure path."""

from __future__ import annotations

from unittest import mock

from apps.communication.broadcasts.services.dispatch import BROADCAST_JOB_TYPE
from apps.communication.broadcasts.tests.base import MESSAGE, BroadcastAPITestCase
from apps.communication.models import AudienceType
from apps.communication.notifications import EMERGENCY_BROADCAST
from apps.communication.tasks import send_emergency_broadcast_task
from apps.communication.tests.factories import NotificationPreferenceFactory
from core.jobs.models import BackgroundJob, JobStatus
from core.jobs.services import create_job
from core.notifications.models import (
    DeliveryLog,
    DeliveryStatus,
    Notification,
    NotificationCategory,
    NotificationChannel,
    NotificationPriority,
)
from core.tenancy.context import tenant_context
from tests.test_celery_routing import routed_queue


class EmergencyBroadcastTaskTests(BroadcastAPITestCase):
    def make_job(self, *recipients) -> BackgroundJob:
        with tenant_context(self.tenant.id):
            return create_job(
                tenant_id=self.tenant.pk,
                job_type=BROADCAST_JOB_TYPE,
                payload={
                    "recipient_ids": [str(user.pk) for user in recipients],
                    "message": MESSAGE,
                    # The confirmed audience was "everyone"; the ids are what it was then.
                    "audience_type": AudienceType.ALL,
                    "audience_filter": {},
                    "campus_id": None,
                },
                actor_id=self.user.pk,
            )

    def run_task(self, job: BackgroundJob) -> BackgroundJob:
        send_emergency_broadcast_task(
            tenant_id=str(self.tenant.pk), job_id=str(job.pk), actor_id=str(self.user.pk)
        )
        with tenant_context(self.tenant.id):
            return BackgroundJob.objects.get(pk=job.pk)

    def test_task_routed_to_emergency_queue(self) -> None:
        self.assertEqual(routed_queue(send_emergency_broadcast_task.name), "emergency")

    def test_task_sends_to_frozen_recipients(self) -> None:
        # Bob and the caller are in "everyone" too; only the frozen ids are sent to.
        job = self.make_job(self.alice)

        job = self.run_task(job)

        self.assertEqual(job.status, JobStatus.SUCCEEDED, job.error)
        self.assertEqual(job.result, {"recipient_count": 1, "notification_count": 1})
        with tenant_context(self.tenant.id):
            [notification] = Notification.objects.filter(event_key=EMERGENCY_BROADCAST)
        self.assertEqual(notification.user_id, self.alice.pk)
        self.assertEqual(notification.body, MESSAGE)
        self.assertEqual(notification.category, NotificationCategory.EMERGENCY)
        self.assertEqual(notification.priority, NotificationPriority.EMERGENCY)
        self.assertEqual(notification.source_id, job.pk)

    def test_task_ignores_preferences(self) -> None:
        with tenant_context(self.tenant.id):
            NotificationPreferenceFactory(
                tenant=self.tenant,
                user_id=self.alice.pk,
                event_category=NotificationCategory.EMERGENCY,
                channel=NotificationChannel.EMAIL,
                is_enabled=False,
            )
        job = self.make_job(self.alice)

        job = self.run_task(job)

        self.assertEqual(job.status, JobStatus.SUCCEEDED, job.error)
        with tenant_context(self.tenant.id):
            email = DeliveryLog.objects.get(
                notification__user_id=self.alice.pk, channel=NotificationChannel.EMAIL
            )
        self.assertEqual(email.status, DeliveryStatus.QUEUED, email.error_message)

    def test_task_failure_marks_job_failed(self) -> None:
        """Fails after the notifications are inserted, so leaked rows would show."""
        job = self.make_job(self.alice, self.bob)

        with mock.patch.object(
            DeliveryLog.objects, "bulk_create", side_effect=RuntimeError("delivery rows failed")
        ) as bulk_create:
            job = self.run_task(job)

        bulk_create.assert_called_once()
        self.assertEqual(job.status, JobStatus.FAILED)
        self.assertEqual(job.error, "delivery rows failed")
        with tenant_context(self.tenant.id):
            self.assertFalse(Notification.objects.filter(event_key=EMERGENCY_BROADCAST).exists())
