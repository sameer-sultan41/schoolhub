"""API-level tests for the notification-templates, notification-preferences and
delivery-logs endpoints.
"""

from __future__ import annotations

from rest_framework import status

from apps.communication.tests.base import CommunicationAPITestCase
from apps.communication.tests.factories import NotificationTemplateOverrideFactory
from core.notifications.catalog import registry as catalog
from core.notifications.models import NotificationCategory, NotificationChannel
from core.notifications.templates import registry as platform_templates
from core.tenancy.context import tenant_context

CODE = "communication-api-test.event"


class TemplateEndpointTests(CommunicationAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self._saved_templates = platform_templates._templates.copy()  # noqa: SLF001
        platform_templates.register(
            CODE,
            channel=NotificationChannel.IN_APP,
            subject="Hi {{ name }}",
            body="Body for {{ name }}",
            variables={"name"},
        )

    def tearDown(self) -> None:
        platform_templates._templates = self._saved_templates  # noqa: SLF001
        super().tearDown()

    def test_creating_an_override_with_an_undeclared_variable_is_refused(self) -> None:
        response = self.client.post(
            "/api/v1/notification-templates",
            {
                "code": CODE,
                "name": "Custom",
                "channel": NotificationChannel.IN_APP,
                "subject": "Hi {{ secret }}",
                "body": "Body",
            },
            format="json",
        )

        # DomainRuleViolation (assert_override_is_valid), not a plain
        # serializer ValidationError — see core/api/exceptions.py.
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_creating_a_valid_override_derives_its_variables(self) -> None:
        response = self.client.post(
            "/api/v1/notification-templates",
            {
                "code": CODE,
                "name": "Custom",
                "channel": NotificationChannel.IN_APP,
                "subject": "Hi {{ name }}",
                "body": "Custom body",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["variables"], ["name"])

    def test_changing_the_code_of_an_existing_override_is_refused(self) -> None:
        with tenant_context(self.tenant.id):
            override = NotificationTemplateOverrideFactory(
                tenant=self.tenant,
                code=CODE,
                channel=NotificationChannel.IN_APP,
                subject="Hi {{ name }}",
                body="Body",
                variables=["name"],
            )

        response = self.client.patch(
            f"/api/v1/notification-templates/{override.pk}",
            {"code": "some.other-code"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_preview_renders_with_sample_data_and_persists_nothing(self) -> None:
        with tenant_context(self.tenant.id):
            override = NotificationTemplateOverrideFactory(
                tenant=self.tenant,
                code=CODE,
                channel=NotificationChannel.IN_APP,
                subject="Hi {{ name }}",
                body="Body for {{ name }}",
                variables=["name"],
            )

        response = self.client.post(f"/api/v1/notification-templates/{override.pk}:preview")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["subject"], "Hi [name]")
        self.assertEqual(response.data["body"], "Body for [name]")


class DeliveryLogEndpointTests(CommunicationAPITestCase):
    def test_post_patch_and_delete_are_not_allowed(self) -> None:
        for method in ("post", "patch", "delete"):
            with self.subTest(method=method):
                response = getattr(self.client, method)("/api/v1/delivery-logs")
                self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)


class PreferenceEndpointTests(CommunicationAPITestCase):
    def test_get_returns_the_full_materialized_matrix(self) -> None:
        response = self.client.get("/api/v1/notification-preferences")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        pairs = {(row["event_category"], row["channel"]) for row in response.data}
        self.assertEqual(
            pairs,
            {
                (category, channel)
                for category in NotificationCategory.values
                for channel in NotificationChannel.values
            },
        )
        self.assertTrue(all(row["is_enabled"] for row in response.data))

    def test_patch_disabling_the_emergency_category_is_refused(self) -> None:
        response = self.client.patch(
            "/api/v1/notification-preferences",
            [
                {
                    "event_category": NotificationCategory.EMERGENCY,
                    "channel": NotificationChannel.SMS,
                    "is_enabled": False,
                }
            ],
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_patch_persists_and_the_next_get_reflects_it(self) -> None:
        response = self.client.patch(
            "/api/v1/notification-preferences",
            [
                {
                    "event_category": NotificationCategory.FEES,
                    "channel": NotificationChannel.SMS,
                    "is_enabled": False,
                }
            ],
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

        response = self.client.get("/api/v1/notification-preferences")
        row = next(
            r
            for r in response.data
            if r["event_category"] == NotificationCategory.FEES
            and r["channel"] == NotificationChannel.SMS
        )
        self.assertFalse(row["is_enabled"])


class DeliverySummaryEndpointTests(CommunicationAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self._saved_catalog = catalog._triggers.copy()  # noqa: SLF001
        self._saved_templates = platform_templates._templates.copy()  # noqa: SLF001
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
        platform_templates._templates = self._saved_templates  # noqa: SLF001
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
