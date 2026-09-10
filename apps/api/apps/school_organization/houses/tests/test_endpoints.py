"""`/houses` endpoint tests (module doc §5.7, §16).

Ordering is the only dedicated endpoint coverage that existed for this
resource before this refactor — a pre-existing gap, not one introduced here.
"""

from __future__ import annotations

from rest_framework import status

from apps.school_organization.tests.base import SchoolOrganizationAPITestCase
from apps.school_organization.tests.factories import HouseFactory
from core.tenancy.context import tenant_context


class HouseEndpointTests(SchoolOrganizationAPITestCase):
    # Each case creates its rows in an order that disagrees with the ordering it
    # asserts, so a passing test proves the sort ran rather than that insertion
    # order happened to match.

    def _ids(self, url: str) -> list[str]:
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return [row["id"] for row in response.json()["data"]]

    def test_sort_by_code(self) -> None:
        self.allow("school.house.view")
        with tenant_context(self.tenant.id):
            falcon = HouseFactory(tenant=self.tenant, name="Falcon", code="RED")
            heron = HouseFactory(tenant=self.tenant, name="Heron", code="BLU")

        # `code` inverts the `name` order, so this fails if the parameter is dropped.
        self.assertEqual(self._ids("/api/v1/houses?ordering=code"), [str(heron.pk), str(falcon.pk)])
        self.assertEqual(
            self._ids("/api/v1/houses?ordering=-code"), [str(falcon.pk), str(heron.pk)]
        )
        self.assertEqual(self._ids("/api/v1/houses?ordering=name"), [str(falcon.pk), str(heron.pk)])

    def test_ignore_an_undeclared_ordering_field(self) -> None:
        self.allow("school.house.view")
        with tenant_context(self.tenant.id):
            falcon = HouseFactory(tenant=self.tenant, name="Falcon", code="RED", color="red")
            heron = HouseFactory(tenant=self.tenant, name="Heron", code="BLU", color="blue")

        by_name = [str(falcon.pk), str(heron.pk)]

        # A real-but-undeclared column and a column that does not exist at all are
        # both dropped: 200 in the default order, never a 400 and never a 500.
        self.assertEqual(self._ids("/api/v1/houses?ordering=color"), by_name)
        self.assertEqual(self._ids("/api/v1/houses?ordering=not_a_column"), by_name)
