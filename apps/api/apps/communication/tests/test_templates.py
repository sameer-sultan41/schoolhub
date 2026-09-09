"""`NotificationTemplateOverride` — a tenant's own wording for a platform template."""

from __future__ import annotations

from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from apps.communication.services import assert_override_is_valid
from apps.communication.templates_service import resolve_tenant_template
from apps.communication.tests.factories import NotificationTemplateOverrideFactory, TenantFactory
from core.api.exceptions import DomainRuleViolation
from core.notifications.models import NotificationChannel
from core.notifications.templates import registry as platform_templates
from core.tenancy.context import tenant_context

CODE = "communication-test.template"


class TemplateOverrideTestCase(TestCase):
    """Registers a throwaway platform template so overrides have something to check against."""

    def setUp(self) -> None:
        super().setUp()
        self._saved_templates = platform_templates._templates.copy()  # noqa: SLF001
        platform_templates.register(
            CODE,
            channel=NotificationChannel.IN_APP,
            subject="Platform subject {{ name }}",
            body="Platform body {{ name }}",
            variables={"name"},
        )
        platform_templates.register(
            CODE,
            channel=NotificationChannel.SMS,
            body="SMS body {{ name }}",
            variables={"name"},
        )
        self.tenant = TenantFactory()

    def tearDown(self) -> None:
        platform_templates._templates = self._saved_templates  # noqa: SLF001
        super().tearDown()


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

    def test_two_overrides_cannot_share_a_tenant_code_channel_locale(self) -> None:
        with tenant_context(self.tenant.id):
            NotificationTemplateOverrideFactory(
                tenant=self.tenant, code=CODE, channel=NotificationChannel.IN_APP
            )
            with self.assertRaises(IntegrityError), transaction.atomic():
                NotificationTemplateOverrideFactory(
                    tenant=self.tenant, code=CODE, channel=NotificationChannel.IN_APP
                )


class ResolveTenantTemplateTests(TemplateOverrideTestCase):
    def test_resolve_tenant_template_returns_none_with_no_matching_override(self) -> None:
        with tenant_context(self.tenant.id):
            result = resolve_tenant_template(CODE, NotificationChannel.IN_APP, "en", self.tenant.pk)

        self.assertIsNone(result)

    def test_resolve_tenant_template_finds_an_active_override(self) -> None:
        with tenant_context(self.tenant.id):
            NotificationTemplateOverrideFactory(
                tenant=self.tenant,
                code=CODE,
                channel=NotificationChannel.IN_APP,
                subject="Overridden subject",
                body="Overridden body",
                variables=["name"],
            )

            result = resolve_tenant_template(CODE, NotificationChannel.IN_APP, "en", self.tenant.pk)

        self.assertIsNotNone(result)
        self.assertEqual(result.body, "Overridden body")
        self.assertEqual(result.variables, frozenset({"name"}))

    def test_an_inactive_override_falls_back_to_the_platform_default(self) -> None:
        with tenant_context(self.tenant.id):
            NotificationTemplateOverrideFactory(
                tenant=self.tenant,
                code=CODE,
                channel=NotificationChannel.IN_APP,
                is_active=False,
            )

            result = resolve_tenant_template(CODE, NotificationChannel.IN_APP, "en", self.tenant.pk)

        self.assertIsNone(result)

    def test_a_soft_deleted_override_falls_back_to_the_platform_default(self) -> None:
        """`.objects` filters only by tenant — `deleted_at` exclusion is the
        caller's job via `.alive()`. `perform_destroy` soft-deletes by setting
        `deleted_at` and leaves `is_active` untouched, so a deleted-but-still-
        `is_active=True` row is exactly the case `.alive()` must catch here."""
        with tenant_context(self.tenant.id):
            override = NotificationTemplateOverrideFactory(
                tenant=self.tenant, code=CODE, channel=NotificationChannel.IN_APP
            )
            override.deleted_at = timezone.now()
            override.save(update_fields=["deleted_at"])

            result = resolve_tenant_template(CODE, NotificationChannel.IN_APP, "en", self.tenant.pk)

        self.assertIsNone(result)

    def test_an_override_for_one_tenant_is_invisible_to_another(self) -> None:
        other_tenant = TenantFactory()
        with tenant_context(self.tenant.id):
            NotificationTemplateOverrideFactory(
                tenant=self.tenant, code=CODE, channel=NotificationChannel.IN_APP
            )

        with tenant_context(other_tenant.id):
            result = resolve_tenant_template(
                CODE, NotificationChannel.IN_APP, "en", other_tenant.pk
            )

        self.assertIsNone(result)


class SystemSeededTemplateTests(TemplateOverrideTestCase):
    def test_a_system_seeded_templates_code_and_channel_are_immutable_by_convention(self) -> None:
        """`is_system` marks the row as seeded; services.py never exposes an
        update path for `code`/`channel` on such a row — the serializer (Task
        A4) is what actually enforces this; here the flag itself round-trips."""
        with tenant_context(self.tenant.id):
            override = NotificationTemplateOverrideFactory(
                tenant=self.tenant, code=CODE, channel=NotificationChannel.IN_APP, is_system=True
            )

        self.assertTrue(override.is_system)
