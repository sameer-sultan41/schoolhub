"""Shared fixture for the template-override tests — registers a throwaway
platform template so overrides have something to check against."""

from __future__ import annotations

from django.test import TestCase

from apps.communication.tests.factories import TenantFactory, enable_feature
from core.notifications.models import NotificationChannel
from core.notifications.templates import registry as platform_templates

CODE = "communication-test.template"


class TemplateOverrideTestCase(TestCase):
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
        enable_feature(self.tenant)

    def tearDown(self) -> None:
        platform_templates._templates = self._saved_templates  # noqa: SLF001
        super().tearDown()
