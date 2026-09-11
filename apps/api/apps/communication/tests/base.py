"""Shared setup for the communication API tests.

An authenticated caller, feature-enabled, holding every key this module
registers so far — the same shape `FeesFinanceAPITestCase` uses, for the same
reason `timetable/tests/test_cross_tenant.py` names: a denial in a test using a
partial key set proves nothing about the endpoint's own check.
"""

from __future__ import annotations

from rest_framework.test import APITestCase

from apps.communication.tests.factories import (
    FEATURE,
    TenantFactory,
    UserFactory,
    authenticate,
    enable_feature,
    grant,
)
from core.notifications.templates import registry as platform_templates

# Every key PR A+B register. §4's remaining keys (thread/broadcast) arrive
# with PR C's endpoints.
ALL_KEYS = (
    "communication.announcement.view",
    "communication.announcement.create",
    "communication.announcement.update",
    "communication.announcement.delete",
    "communication.announcement.publish",
    "communication.notice.view",
    "communication.notice.create",
    "communication.notice.update",
    "communication.notice.publish",
    "communication.notice.acknowledge",
    "communication.template.view",
    "communication.template.update",
    "communication.notification-preference.update",
    "communication.delivery-log.view",
    "communication.delivery-log.export",
)


class CommunicationAPITestCase(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)
        enable_feature(self.tenant, FEATURE)
        grant(self.user, *ALL_KEYS)


class PlatformTemplateFixtureMixin:
    """Save/restore `core.notifications.templates.registry`'s in-memory
    template store around a test.

    Every test that registers its own throwaway platform template — to
    validate overrides, previews or delivery against it — needs this. Not a
    `TestCase` subclass itself, so it composes with either a plain
    `django.test.TestCase` (`template_overrides/tests/base.py
    ::TemplateOverrideTestCase`) or `CommunicationAPITestCase`
    (`template_overrides/tests/test_endpoints.py::TemplateEndpointTests`,
    `delivery/tests/test_endpoints.py::DeliverySummaryEndpointTests`) — each
    still registers its own specific template(s) in its own `setUp`, after
    calling `super().setUp()`.
    """

    def setUp(self) -> None:
        super().setUp()
        self._saved_templates = platform_templates._templates.copy()  # noqa: SLF001

    def tearDown(self) -> None:
        platform_templates._templates = self._saved_templates  # noqa: SLF001
        super().tearDown()
