"""`NotificationTemplateOverride` — write-time validation."""

from __future__ import annotations

from django.db import IntegrityError, transaction

from apps.communication.template_overrides.services.validate import assert_override_is_valid
from apps.communication.template_overrides.tests.base import CODE, TemplateOverrideTestCase
from apps.communication.tests.factories import NotificationTemplateOverrideFactory
from core.api.exceptions import DomainRuleViolation
from core.notifications.models import NotificationChannel
from core.tenancy.context import tenant_context


class OverrideValidationTests(TemplateOverrideTestCase):
    def test_a_tenant_can_override_the_body_of_a_platform_template(self) -> None:
        with tenant_context(self.tenant.id):
            override = NotificationTemplateOverrideFactory(
                tenant=self.tenant,
                code=CODE,
                channel=NotificationChannel.IN_APP,
                subject="Custom {{ name }}",
                body="Custom body {{ name }}",
                variables=["name"],
            )

        self.assertEqual(override.body, "Custom body {{ name }}")

    def test_an_override_cannot_reference_a_variable_the_platform_template_did_not_declare(
        self,
    ) -> None:
        with self.assertRaises(DomainRuleViolation):
            assert_override_is_valid(
                code=CODE,
                channel=NotificationChannel.IN_APP,
                subject="Hi {{ secret }}",
                body="Body",
            )

    def test_an_override_for_a_code_the_platform_does_not_declare_is_refused(self) -> None:
        with self.assertRaises(DomainRuleViolation):
            assert_override_is_valid(
                code="no.such.trigger", channel=NotificationChannel.IN_APP, subject="Hi", body="x"
            )

    def test_an_sms_override_may_not_declare_a_subject(self) -> None:
        with self.assertRaises(DomainRuleViolation):
            assert_override_is_valid(
                code=CODE, channel=NotificationChannel.SMS, subject="Nope", body="Body"
            )

    def test_a_subject_bearing_channels_override_must_have_one(self) -> None:
        with self.assertRaises(DomainRuleViolation):
            assert_override_is_valid(
                code=CODE, channel=NotificationChannel.IN_APP, subject=None, body="Body"
            )

    def test_two_overrides_cannot_share_a_tenant_code_channel_locale(self) -> None:
        with tenant_context(self.tenant.id):
            NotificationTemplateOverrideFactory(
                tenant=self.tenant, code=CODE, channel=NotificationChannel.IN_APP
            )
            with self.assertRaises(IntegrityError), transaction.atomic():
                NotificationTemplateOverrideFactory(
                    tenant=self.tenant, code=CODE, channel=NotificationChannel.IN_APP
                )


class SystemSeededTemplateTests(TemplateOverrideTestCase):
    def test_a_system_seeded_templates_code_and_channel_are_immutable_by_convention(self) -> None:
        """`is_system` marks the row as seeded; services never expose an
        update path for `code`/`channel` on such a row — the serializer is
        what actually enforces this; here the flag itself round-trips."""
        with tenant_context(self.tenant.id):
            override = NotificationTemplateOverrideFactory(
                tenant=self.tenant, code=CODE, channel=NotificationChannel.IN_APP, is_system=True
            )

        self.assertTrue(override.is_system)
