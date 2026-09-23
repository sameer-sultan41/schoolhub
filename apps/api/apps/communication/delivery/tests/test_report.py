"""`services.report.delivery_report` — one query, regardless of how many rows it groups."""

from __future__ import annotations

import uuid

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from apps.communication.delivery.services import report
from apps.communication.tests.factories import TenantFactory
from core.notifications.models import DeliveryLog, DeliveryStatus, Notification, NotificationChannel
from core.tenancy.context import tenant_context


def _make_notification(*, tenant) -> Notification:
    return Notification.objects.create(
        tenant_id=tenant.pk,
        user_id=uuid.uuid4(),
        event_key="test.event",
        title="Hi",
        body="Body",
    )


class DeliveryReportTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()

    def test_groups_and_counts_by_channel(self) -> None:
        with tenant_context(self.tenant.id):
            notification = _make_notification(tenant=self.tenant)
            DeliveryLog.objects.create(
                tenant_id=self.tenant.pk,
                notification=notification,
                channel=NotificationChannel.IN_APP,
                recipient_address="x",
                status=DeliveryStatus.DELIVERED,
            )
            DeliveryLog.objects.create(
                tenant_id=self.tenant.pk,
                notification=notification,
                channel=NotificationChannel.EMAIL,
                recipient_address="x",
                status=DeliveryStatus.QUEUED,
            )
            DeliveryLog.objects.create(
                tenant_id=self.tenant.pk,
                notification=notification,
                channel=NotificationChannel.EMAIL,
                recipient_address="x",
                status=DeliveryStatus.SENT,
            )

            rows = report.delivery_report(DeliveryLog.objects.all(), group_by="channel")

        self.assertEqual(
            rows,
            [
                {"group": NotificationChannel.EMAIL, "count": 2},
                {"group": NotificationChannel.IN_APP, "count": 1},
            ],
        )

    def test_is_a_single_query_regardless_of_row_count(self) -> None:
        with tenant_context(self.tenant.id):
            notification = _make_notification(tenant=self.tenant)
            DeliveryLog.objects.bulk_create(
                [
                    DeliveryLog(
                        tenant_id=self.tenant.pk,
                        notification=notification,
                        channel=NotificationChannel.IN_APP,
                        recipient_address="x",
                        status=DeliveryStatus.DELIVERED,
                    )
                    for _ in range(50)
                ]
            )

            with CaptureQueriesContext(connection) as captured:
                report.delivery_report(DeliveryLog.objects.all(), group_by="channel")

        self.assertEqual(len(captured.captured_queries), 1)

    def test_an_unrecognised_group_by_raises(self) -> None:
        with tenant_context(self.tenant.id), self.assertRaises(KeyError):
            report.delivery_report(DeliveryLog.objects.all(), group_by="nonsense")
