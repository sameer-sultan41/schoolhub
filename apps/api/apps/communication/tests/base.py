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

# Every key PR A registers. §4's remaining keys (announcement/notice/thread/
# broadcast) arrive with the PRs that ship their endpoints.
ALL_KEYS = (
    "communication.announcement.view",
    "communication.notice.view",
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
