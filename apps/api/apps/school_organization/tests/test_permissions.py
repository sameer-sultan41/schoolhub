"""Generic RBAC enforcement tests for the school-organization module (module doc §4).

`/api/v1/campuses` and `/api/v1/houses` are stand-ins here — these tests prove
the platform-wide permission mechanism (401/403/view-key-grants-no-write)
works for this module, not anything specific to those two resources.

`/class-subjects` moved to academics in this PR — the route is unchanged but
the keys and the feature flag are not, so its endpoint tests moved with it to
`apps/academics/tests/test_api.py::CurriculumEndpointTests`. What stays here is
the *model* and `map_subject_to_class`, which school_organization still owns
(see the ownership note in academics/views.py). Testing an endpoint from the
module that no longer guards it means granting keys this module does not own.
"""

from __future__ import annotations

from rest_framework import status

from apps.school_organization.tests.base import SchoolOrganizationAPITestCase


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
