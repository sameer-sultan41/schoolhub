"""`/school-settings` endpoint tests (module doc §16)."""

from __future__ import annotations

import uuid
from unittest import mock

from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework import status

from apps.school_organization.school_settings import services
from apps.school_organization.tests.base import SchoolOrganizationAPITestCase
from apps.school_organization.tests.factories import TenantFactory
from core.audit.models import AuditLog
from core.files.models import FileStatus
from core.files.tests.factories import FileFactory
from core.tenancy.context import tenant_context
from core.tenancy.models import TenantSettings

SETTINGS = "/api/v1/school-settings"


class SchoolSettingsProfileTests(SchoolOrganizationAPITestCase):
    """The school's name, its logo and the branding merge (the PR F settings fixes)."""

    def setUp(self) -> None:
        super().setUp()
        self.allow("school.settings.view", "school.settings.update")

    def _patch(self, body: dict):
        return self.client.patch(SETTINGS, body, format="json")

    def _file(self, tenant=None, **overrides):
        owner = tenant or self.tenant
        with tenant_context(owner.id):
            return FileFactory(
                tenant=owner, **{"purpose": "school.logo", "mime_type": "image/png", **overrides}
            )

    def _error(self, response) -> dict:
        """The error envelope without its per-request id, for comparing two refusals."""
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        error = dict(response.json()["error"])
        error.pop("request_id")
        return error

    def test_patch_name_updates_tenant_and_audits_name(self) -> None:
        old_name = self.tenant.name

        response = self._patch({"name": "City School North"})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["name"], "City School North")
        self.tenant.refresh_from_db()
        self.assertEqual(self.tenant.name, "City School North")
        with tenant_context(self.tenant.id):
            row = TenantSettings.objects.get(tenant=self.tenant)
            entry = AuditLog.objects.get(action="update", resource_id=row.pk)
        self.assertEqual(entry.before["name"], old_name)
        self.assertEqual(entry.after["name"], "City School North")

    def test_patch_rejects_a_blank_name(self) -> None:
        response = self._patch({"name": "  "})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.json()["error"]["details"][0]["field"], "name")

    def test_patch_ignores_slug_and_status(self) -> None:
        slug, tenant_status = self.tenant.slug, self.tenant.status

        response = self._patch({"slug": "taken-over", "status": "suspended", "locale": "ur"})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.tenant.refresh_from_db()
        self.assertEqual(self.tenant.slug, slug)
        self.assertEqual(self.tenant.status, tenant_status)
        self.assertEqual(self.tenant.locale, "ur")

    def test_patch_ignores_academic_which_only_its_own_endpoints_write(self) -> None:
        """`/holiday-calendar` and `/attendance-settings` validate their keys; a whole `academic`
        document through this PATCH would bypass them, so it is not a field."""
        with tenant_context(self.tenant.id):
            TenantSettings.objects.update_or_create(
                tenant=self.tenant, defaults={"academic": {"attendance_mode": "daily"}}
            )

        response = self._patch({"academic": {"attendance_mode": "period"}, "locale": "ur"})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["academic"], {"attendance_mode": "daily"})
        with tenant_context(self.tenant.id):
            row = TenantSettings.objects.get(tenant=self.tenant)
        self.assertEqual(row.academic, {"attendance_mode": "daily"})
        self.tenant.refresh_from_db()
        self.assertEqual(self.tenant.locale, "ur")

    def test_logo_is_set_and_returned_as_a_signed_link(self) -> None:
        logo = self._file()

        response = self._patch({"logo_file_id": str(logo.pk)})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        body = self.client.get(SETTINGS).json()["data"]
        self.assertEqual(body["logo_file_id"], str(logo.pk))
        self.assertIn(logo.storage_key, body["logo_url"])

    def test_logo_null_removes_it(self) -> None:
        logo = self._file()
        self._patch({"logo_file_id": str(logo.pk)})

        response = self._patch({"logo_file_id": None})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertIsNone(response.json()["data"]["logo_file_id"])
        self.assertIsNone(response.json()["data"]["logo_url"])

    def test_logo_other_tenants_file_same_422_as_unknown(self) -> None:
        foreign = self._file(tenant=TenantFactory())

        unknown = self._error(self._patch({"logo_file_id": str(uuid.uuid4())}))
        other_tenants = self._error(self._patch({"logo_file_id": str(foreign.pk)}))

        self.assertEqual(other_tenants, unknown)
        self.assertEqual(unknown["details"][0]["field"], "logo_file_id")
        self.assertIsNone(self.client.get(SETTINGS).json()["data"]["logo_file_id"])

    def test_logo_wrong_purpose_422(self) -> None:
        unknown = self._error(self._patch({"logo_file_id": str(uuid.uuid4())}))
        cases = {
            "another purpose": self._file(purpose="staff.photo"),
            "an upload never confirmed": self._file(status=FileStatus.PENDING),
        }
        for case, file in cases.items():
            with self.subTest(case):
                self.assertEqual(self._error(self._patch({"logo_file_id": str(file.pk)})), unknown)

    def test_branding_patch_merges_primary_color_survives_logo(self) -> None:
        self._patch({"branding": {"primary_color": "#1E88E5", "radius": "0.5rem"}})
        logo = self._file()

        response = self._patch(
            {"logo_file_id": str(logo.pk), "branding": {"secondary_color": "#FFFFFF"}}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(
            self.client.get(SETTINGS).json()["data"]["branding"],
            {"primary_color": "#1E88E5", "radius": "0.5rem", "secondary_color": "#FFFFFF"},
        )

    def test_patch_locks_the_row_and_writes_only_the_columns_it_changes(self) -> None:
        """A write to another column between the PATCH's read and its save survives it."""
        concurrent = {"ai": {"monthly_token_budget": 5000}, "academic": {"working_days": [0, 1]}}
        real_represent = services.represent
        calls: list[int] = []

        def write_elsewhere_then_represent(tenant, settings_row):
            # The first call is the `before` read, taken after the row is read and locked.
            if not calls:
                TenantSettings.objects.filter(pk=settings_row.pk).update(**concurrent)
            calls.append(1)
            return real_represent(tenant, settings_row)

        with (
            mock.patch.object(services, "represent", side_effect=write_elsewhere_then_represent),
            CaptureQueriesContext(connection) as captured,
        ):
            response = self._patch({"branding": {"primary_color": "#123456"}})
        sql = [query["sql"] for query in captured.captured_queries]

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertTrue(
            any("FOR UPDATE" in q and '"tenant_settings"' in q for q in sql), "row not locked"
        )
        with tenant_context(self.tenant.id):
            row = TenantSettings.objects.get(tenant=self.tenant)
        self.assertEqual(row.ai, concurrent["ai"])
        self.assertEqual(row.academic, concurrent["academic"])
        self.assertEqual(row.branding, {"primary_color": "#123456"})

    def test_branding_rejects_a_primary_color_that_is_not_hex(self) -> None:
        response = self._patch({"branding": {"primary_color": "bg-blue-500"}})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.json()["error"]["details"][0]["field"], "branding.primary_color")


class SchoolSettingsEndpointTests(SchoolOrganizationAPITestCase):
    def test_read_returns_the_tenant_configuration(self) -> None:
        self.allow("school.settings.view")
        response = self.client.get("/api/v1/school-settings")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["data"]["currency"], "USD")

    def test_update_requires_the_update_permission(self) -> None:
        self.allow("school.settings.view")
        response = self.client.patch("/api/v1/school-settings", {"locale": "ur"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_update_writes_configuration_and_branding(self) -> None:
        self.allow("school.settings.view", "school.settings.update")
        response = self.client.patch(
            "/api/v1/school-settings",
            {"locale": "ur", "currency": "pkr", "branding": {"primary_color": "#123456"}},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()["data"]
        self.assertEqual(body["currency"], "PKR")
        self.assertEqual(body["branding"], {"primary_color": "#123456"})

        self.tenant.refresh_from_db()
        self.assertEqual(self.tenant.locale, "ur")

    def test_update_rejects_a_non_iana_timezone(self) -> None:
        self.allow("school.settings.view", "school.settings.update")
        response = self.client.patch(
            "/api/v1/school-settings", {"timezone": "Middle/Earth"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
