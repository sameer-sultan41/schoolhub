"""`/campuses` endpoint tests (module doc §5.2, §16).

Paths are written out literally rather than reversed: the URL shape *is* the
contract, and a test that reverses the name would keep passing after the
contract broke.
"""

from __future__ import annotations

import datetime

from rest_framework import status

from apps.school_organization.models import Campus
from apps.school_organization.tests.base import SchoolOrganizationAPITestCase
from apps.school_organization.tests.factories import CampusFactory, ClassFactory, SectionFactory
from core.tenancy.context import tenant_context


class CampusEndpointTests(SchoolOrganizationAPITestCase):
    def test_create_requires_the_create_permission(self) -> None:
        self.allow("school.campus.view")
        response = self.client.post(
            "/api/v1/campuses", {"name": "North Campus", "code": "north"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_create_normalizes_the_code_and_stamps_the_tenant(self) -> None:
        self.allow("school.campus.view", "school.campus.create")
        response = self.client.post(
            "/api/v1/campuses",
            {"name": "North Campus", "code": " north ", "timezone": "Asia/Karachi"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.json()["data"]["code"], "NORTH")

        with tenant_context(self.tenant.id):
            campus = Campus.objects.get(code="NORTH")
        self.assertEqual(campus.tenant_id, self.tenant.id)
        self.assertEqual(campus.created_by, self.user.pk)

    def test_create_rejects_a_non_iana_timezone(self) -> None:
        self.allow("school.campus.view", "school.campus.create")
        response = self.client.post(
            "/api/v1/campuses",
            {"name": "North", "code": "N1", "timezone": "PKT"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.json()["error"]["code"], "validation_error")

    def test_list_is_filtered_by_is_active(self) -> None:
        self.allow("school.campus.view")
        with tenant_context(self.tenant.id):
            CampusFactory(tenant=self.tenant, is_active=True)
            CampusFactory(tenant=self.tenant, is_active=False)

        response = self.client.get("/api/v1/campuses?is_active=true")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.json()["data"]), 1)

    def test_list_excludes_soft_deleted_rows(self) -> None:
        self.allow("school.campus.view")
        with tenant_context(self.tenant.id):
            campus = CampusFactory(tenant=self.tenant)
            campus.deleted_at = datetime.datetime.now(tz=datetime.UTC)
            campus.save(update_fields=["deleted_at"])

        response = self.client.get("/api/v1/campuses")

        self.assertEqual(response.json()["data"], [])

    def test_promoting_a_primary_campus_demotes_the_incumbent(self) -> None:
        self.allow("school.campus.view", "school.campus.create")
        with tenant_context(self.tenant.id):
            incumbent = CampusFactory(tenant=self.tenant, is_primary=True)

        response = self.client.post(
            "/api/v1/campuses",
            {"name": "South", "code": "SOUTH", "is_primary": True},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        incumbent.refresh_from_db()
        self.assertFalse(incumbent.is_primary)

    def test_delete_soft_deletes(self) -> None:
        self.allow("school.campus.view", "school.campus.delete")
        with tenant_context(self.tenant.id):
            campus = CampusFactory(tenant=self.tenant)

        response = self.client.delete(f"/api/v1/campuses/{campus.pk}")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        campus.refresh_from_db()
        self.assertIsNotNone(campus.deleted_at)

    def test_delete_is_blocked_while_dependents_exist(self) -> None:
        self.allow("school.campus.view", "school.campus.delete")
        with tenant_context(self.tenant.id):
            campus = CampusFactory(tenant=self.tenant)
            SectionFactory(
                tenant=self.tenant, campus=campus, school_class=ClassFactory(tenant=self.tenant)
            )

        response = self.client.delete(f"/api/v1/campuses/{campus.pk}")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        campus.refresh_from_db()
        self.assertIsNone(campus.deleted_at)

    # ------------------------------------------------------------------ ordering
    #
    # Each case creates its rows in an order that disagrees with the ordering it
    # asserts, so a passing test proves the sort ran rather than that insertion
    # order happened to match. The undeclared-field case carries as much weight
    # as the sorts: `ordering_fields` is an allowlist and DRF drops anything
    # outside it *silently*, so the only way to tell an ignored parameter from an
    # honoured one is to give the undeclared column values that would visibly
    # reorder the list.

    def _ids(self, url: str) -> list[str]:
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return [row["id"] for row in response.json()["data"]]

    def test_sort_by_name(self) -> None:
        self.allow("school.campus.view")
        with tenant_context(self.tenant.id):
            north = CampusFactory(tenant=self.tenant, name="North", code="NORTH")
            east = CampusFactory(tenant=self.tenant, name="East", code="EAST")
            south = CampusFactory(tenant=self.tenant, name="South", code="SOUTH")

        ascending = [str(east.pk), str(north.pk), str(south.pk)]

        self.assertEqual(self._ids("/api/v1/campuses?ordering=name"), ascending)
        self.assertEqual(self._ids("/api/v1/campuses?ordering=-name"), ascending[::-1])

    def test_sort_by_the_flag_columns(self) -> None:
        self.allow("school.campus.view")
        with tenant_context(self.tenant.id):
            flagship = CampusFactory(
                tenant=self.tenant, name="Flagship", code="FLAG", is_primary=True
            )
            closed = CampusFactory(
                tenant=self.tenant, name="Closed", code="CLOSED", is_active=False
            )

        # false sorts before true, so ascending `is_active` leads with the closed
        # campus and descending `is_primary` leads with the flagship.
        self.assertEqual(
            self._ids("/api/v1/campuses?ordering=is_active"), [str(closed.pk), str(flagship.pk)]
        )
        self.assertEqual(
            self._ids("/api/v1/campuses?ordering=-is_primary"), [str(flagship.pk), str(closed.pk)]
        )

    def test_ignore_an_undeclared_ordering_field(self) -> None:
        self.allow("school.campus.view")
        with tenant_context(self.tenant.id):
            north = CampusFactory(tenant=self.tenant, name="North", code="N", timezone="Asia/Aden")
            east = CampusFactory(tenant=self.tenant, name="East", code="E", timezone="Europe/Rome")

        # `timezone` is a real column and would put North first if it sorted. It is
        # not in `ordering_fields`, so the list stays in the view's default `name`
        # order — a 200 in the wrong order is the failure this guards against, not
        # a 400.
        self.assertEqual(
            self._ids("/api/v1/campuses?ordering=timezone"), [str(east.pk), str(north.pk)]
        )
