"""Designations — HTTP endpoint round trips.

URLs are literal strings, not ``reverse()`` — the URL *is* the contract (see
school_organization/houses/tests/test_endpoints.py's identical convention).
"""

from __future__ import annotations

from rest_framework import status

from apps.staff_management.tests.base import StaffManagementAPITestCase
from apps.staff_management.tests.factories import DesignationFactory, StaffFactory
from core.tenancy.context import tenant_context


class DesignationCrudTests(StaffManagementAPITestCase):
    def test_create_a_designation(self) -> None:
        self.allow("staff.designation.create", "staff.designation.view")

        response = self.client.post(
            "/api/v1/designations", {"name": "Senior Teacher", "code": "SR-TCH"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())

    def test_create_without_the_permission_is_403(self) -> None:
        response = self.client.post(
            "/api/v1/designations", {"name": "Senior Teacher"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_deactivating_a_designation_assigned_to_staff_is_rejected(self) -> None:
        self.allow("staff.designation.create", "staff.designation.update")
        with tenant_context(self.tenant.id):
            designation = DesignationFactory(tenant=self.tenant)
            StaffFactory(tenant=self.tenant, campus=self.campus, designation=designation)

        response = self.client.patch(
            f"/api/v1/designations/{designation.pk}", {"is_active": False}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(response.json()["error"]["code"], "domain_rule_violation")

    def test_deactivating_an_unassigned_designation_succeeds(self) -> None:
        """Positive control: the block above is about assignment, not about PATCH itself."""
        self.allow("staff.designation.create", "staff.designation.update")
        with tenant_context(self.tenant.id):
            designation = DesignationFactory(tenant=self.tenant)

        response = self.client.patch(
            f"/api/v1/designations/{designation.pk}", {"is_active": False}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertFalse(response.json()["data"]["is_active"])

    def test_deleting_a_designation_assigned_to_staff_is_rejected(self) -> None:
        self.allow("staff.designation.delete")
        with tenant_context(self.tenant.id):
            designation = DesignationFactory(tenant=self.tenant)
            StaffFactory(tenant=self.tenant, campus=self.campus, designation=designation)

        response = self.client.delete(f"/api/v1/designations/{designation.pk}")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)


class DesignationOrderingTests(StaffManagementAPITestCase):
    """`/designations` declared no `ordering_fields` at all until this suite.

    That is not "unsorted": `OrderingFilter` is a project-wide default and falls
    back to every serializer field when a view names none, so `?ordering=level`
    was already live on an unindexed nullable column and `?ordering=description`
    on one nobody would ever want to sort by. These tests pin both sides of the
    allowlist that closed it.
    """

    def _catalog(self) -> None:
        """Three rows whose name, code, level and description orders all differ.

        Deliberately: a sort assertion only proves something if the column under
        test is the one that could have produced that sequence.
        """
        with tenant_context(self.tenant.id):
            DesignationFactory(
                tenant=self.tenant, name="Coordinator", code="C", level=3, description="A"
            )
            DesignationFactory(
                tenant=self.tenant, name="Assistant", code="A", level=9, description="B"
            )
            DesignationFactory(tenant=self.tenant, name="Head", code="B", level=1, description="C")

    def _names(self, query: str) -> list[str]:
        response = self.client.get(f"/api/v1/designations{query}")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return [row["name"] for row in response.json()["data"]]

    def test_orders_by_level_ascending(self) -> None:
        self.allow("staff.designation.view")
        self._catalog()

        self.assertEqual(self._names("?ordering=level"), ["Head", "Coordinator", "Assistant"])

    def test_orders_by_level_descending(self) -> None:
        self.allow("staff.designation.view")
        self._catalog()

        self.assertEqual(self._names("?ordering=-level"), ["Assistant", "Coordinator", "Head"])

    def test_orders_by_code(self) -> None:
        self.allow("staff.designation.view")
        self._catalog()

        self.assertEqual(self._names("?ordering=code"), ["Assistant", "Head", "Coordinator"])
        self.assertEqual(self._names("?ordering=-code"), ["Coordinator", "Head", "Assistant"])

    def test_orders_by_name(self) -> None:
        self.allow("staff.designation.view")
        self._catalog()

        self.assertEqual(self._names("?ordering=-name"), ["Head", "Coordinator", "Assistant"])

    def test_an_undeclared_ordering_field_is_ignored_rather_than_an_error(self) -> None:
        """`description` is on the serializer, so this used to be an accepted sort."""
        self.allow("staff.designation.view")
        self._catalog()

        # Designation.Meta.ordering by name, not anything `description` implies.
        self.assertEqual(self._names("?ordering=description"), ["Assistant", "Coordinator", "Head"])
