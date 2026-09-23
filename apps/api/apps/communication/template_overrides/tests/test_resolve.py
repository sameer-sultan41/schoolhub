"""`resolve_tenant_template` — the `core.notifications` override resolver."""

from __future__ import annotations

from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.communication.template_overrides.services.resolve import resolve_tenant_template
from apps.communication.template_overrides.tests.base import CODE, TemplateOverrideTestCase
from apps.communication.tests.factories import NotificationTemplateOverrideFactory, TenantFactory
from core.notifications.models import NotificationChannel
from core.tenancy.context import tenant_context


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


class FeatureGateTests(TemplateOverrideTestCase):
    """`resolve_tenant_template` must not query for a tenant that hasn't enabled
    `module.communication` — it is registered process-wide, but the flag ships
    `default_enabled=False`, and every notify() call platform-wide reaches this
    resolver regardless of which module fired the trigger."""

    def setUp(self) -> None:
        super().setUp()
        # The base class enables the feature for every other test in this file;
        # this class is specifically about what happens when it is off, so a
        # fresh tenant that was never granted it is used instead of self.tenant.
        self.disabled_tenant = TenantFactory()

    def test_returns_none_without_querying_the_override_table_when_the_module_is_disabled(
        self,
    ) -> None:
        with tenant_context(self.disabled_tenant.id):
            NotificationTemplateOverrideFactory(
                tenant=self.disabled_tenant, code=CODE, channel=NotificationChannel.IN_APP
            )

            with CaptureQueriesContext(connection) as captured:
                result = resolve_tenant_template(
                    CODE, NotificationChannel.IN_APP, "en", self.disabled_tenant.pk
                )

        self.assertIsNone(result)
        # The feature-flag check itself queries FeatureFlag/TenantFeatureOverride;
        # what matters is that it short-circuits before ever reaching this table —
        # an override exists above (created deliberately, to prove it is ignored).
        queries = [q["sql"] for q in captured.captured_queries]
        self.assertFalse(any("notification_templates" in sql for sql in queries), queries)
