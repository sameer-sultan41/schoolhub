"""`TenantSettings.ai` is platform-set: no tenant-facing endpoint may write it (SEC-16).

The monthly token budget is what a school's plan pays for, so a school admin who can
edit the school's settings must not be able to raise it.
"""

from __future__ import annotations

from rest_framework import status

from apps.school_organization.school_settings.serializers import SchoolSettingsSerializer
from apps.school_organization.tests.base import SchoolOrganizationAPITestCase
from core.ai.tests.base import set_budget
from core.tenancy.context import tenant_context
from core.tenancy.models import TenantSettings


class AINamespaceTests(SchoolOrganizationAPITestCase):
    def test_settings_api_cannot_write_ai_namespace(self) -> None:
        self.assertNotIn("ai", SchoolSettingsSerializer().fields)
        self.allow("school.settings.view", "school.settings.update")
        set_budget(self.tenant, 1000)

        response = self.client.patch(
            "/api/v1/school-settings",
            {"locale": "ur", "ai": {"monthly_token_budget": 999_999_999}},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertNotIn("ai", response.json()["data"])
        with tenant_context(self.tenant.id):
            row = TenantSettings.objects.get(tenant=self.tenant)
        self.assertEqual(row.ai, {"monthly_token_budget": 1000})
