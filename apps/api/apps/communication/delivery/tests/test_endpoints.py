"""`/delivery-logs` — HTTP endpoint round trips."""

from __future__ import annotations

from rest_framework import status

from apps.communication.tests.base import CommunicationAPITestCase, PlatformTemplateFixtureMixin
from core.notifications.catalog import registry as catalog
from core.notifications.models import NotificationCategory, NotificationChannel
from core.notifications.templates import registry as platform_templates
from core.tenancy.context import tenant_context

CODE = "communication-api-test.event"


class DeliveryLogEndpointTests(CommunicationAPITestCase):
    def test_post_patch_and_delete_are_not_allowed(self) -> None:
        for method in ("post", "patch", "delete"):
            with self.subTest(method=method):
                response = getattr(self.client, method)("/api/v1/delivery-logs")
                self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)


class DeliverySummaryEndpointTests(PlatformTemplateFixtureMixin, CommunicationAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self._saved_catalog = catalog._triggers.copy()  # noqa: SLF001
        catalog.register(
            CODE,
            template_code=CODE,
            category=NotificationCategory.GENERAL,
            channels={NotificationChannel.IN_APP},
            variables={"name"},
        )
        platform_templates.register(
            CODE,
            channel=NotificationChannel.IN_APP,
            subject="Hi {{ name }}",
            body="Body for {{ name }}",
            variables={"name"},
        )

    def tearDown(self) -> None:
        catalog._triggers = self._saved_catalog  # noqa: SLF001
        super().tearDown()

    def test_summary_groups_by_channel_by_default(self) -> None:
        from core.notifications.services import Recipient, notify

        with self.captureOnCommitCallbacks(execute=False), tenant_context(self.tenant.id):
            notify(
                CODE,
                tenant_id=self.tenant.pk,
                recipients=[Recipient(user_id=self.user.pk)],
                context={"name": "Ayesha"},
            )

        response = self.client.get("/api/v1/delivery-logs:summary")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["data"], [{"group": NotificationChannel.IN_APP, "count": 1}])

    def test_summary_rejects_an_unknown_group_by(self) -> None:
        response = self.client.get("/api/v1/delivery-logs:summary?group_by=nonsense")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
