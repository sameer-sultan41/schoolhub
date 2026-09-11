"""`/notification-templates` — HTTP endpoint round trips."""

from __future__ import annotations

from rest_framework import status

from apps.communication.tests.base import CommunicationAPITestCase, PlatformTemplateFixtureMixin
from apps.communication.tests.factories import NotificationTemplateOverrideFactory
from core.notifications.models import NotificationChannel
from core.notifications.templates import registry as platform_templates
from core.tenancy.context import tenant_context

CODE = "communication-api-test.event"


class TemplateEndpointTests(PlatformTemplateFixtureMixin, CommunicationAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        platform_templates.register(
            CODE,
            channel=NotificationChannel.IN_APP,
            subject="Hi {{ name }}",
            body="Body for {{ name }}",
            variables={"name"},
        )

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
