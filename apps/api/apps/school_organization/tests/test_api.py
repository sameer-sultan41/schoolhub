"""API tests for the school-organization endpoints (module doc §16).

Paths are written out literally rather than reversed: the URL shape *is* the
contract (``/api/v1/campuses``), and a test that reverses the name would keep
passing after the contract broke.
"""

from __future__ import annotations

from rest_framework import status

from apps.school_organization.tests.base import SchoolOrganizationAPITestCase

# `/class-subjects` moved to academics in this PR — the route is unchanged but
# the keys and the feature flag are not, so its endpoint tests moved with it to
# `apps/academics/tests/test_api.py::CurriculumEndpointTests`. What stays here is
# the *model* and `map_subject_to_class`, which school_organization still owns
# (see the ownership note in academics/views.py). Testing an endpoint from the
# module that no longer guards it means granting keys this module does not own.


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


class PermissionEnforcementTests(SchoolOrganizationAPITestCase):
    def test_an_endpoint_is_closed_without_any_permission(self) -> None:
        response = self.client.get("/api/v1/campuses")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_an_unauthenticated_request_is_rejected(self) -> None:
        self.client.credentials()
        self.client.logout()

        response = self.client.get("/api/v1/campuses")

        self.assertIn(
            response.status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )

    def test_a_view_key_does_not_grant_writes(self) -> None:
        self.allow("school.house.view")
        response = self.client.post("/api/v1/houses", {"name": "Falcon"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
