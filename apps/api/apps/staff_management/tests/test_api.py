"""API-level tests for the staff-management module.

URLs are literal strings, not ``reverse()`` — the URL *is* the contract (see
school_organization/tests/test_api.py's identical convention).
"""

from __future__ import annotations

import datetime

from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import (
    CampusFactory,
    DepartmentFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.staff_management.models import Staff
from apps.staff_management.tests.factories import (
    DEFAULT_JOINING_DATE,
    DesignationFactory,
    StaffFactory,
    enable_feature,
)
from core.tenancy.context import tenant_context


class StaffManagementAPITestCase(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)
        enable_feature(self.tenant, "module.staff")
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)

    def allow(self, *keys: str) -> None:
        grant(self.user, *keys)


class ModuleFeatureGateTests(StaffManagementAPITestCase):
    def test_the_module_flag_off_is_403_module_disabled_even_with_permission(self) -> None:
        from core.tenancy.models import FeatureFlag, TenantFeatureOverride

        self.allow("staff.staff.view")
        with tenant_context(self.tenant.id):
            TenantFeatureOverride.objects.filter(tenant=self.tenant).delete()
            flag = FeatureFlag.objects.get(key="module.staff")
            TenantFeatureOverride.objects.create(
                tenant=self.tenant, feature_flag=flag, enabled=False, reason="test"
            )

        response = self.client.get("/api/v1/staff")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.json()["error"]["code"], "module_disabled")


class StaffCreateTests(StaffManagementAPITestCase):
    def _payload(self, **overrides) -> dict:
        payload = {
            "first_name": "Amina",
            "last_name": "Khan",
            "staff_type": "teaching",
            "campus_id": str(self.campus.pk),
            "joining_date": str(DEFAULT_JOINING_DATE),
            "phone": "+923001234567",
        }
        payload.update(overrides)
        return payload

    def test_create_allocates_an_employee_number_and_stamps_the_tenant(self) -> None:
        self.allow("staff.staff.create", "staff.staff.view")

        response = self.client.post("/api/v1/staff", self._payload(), format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        data = response.json()["data"]
        self.assertTrue(data["employee_number"])

        with tenant_context(self.tenant.id):
            created = Staff.objects.get(pk=data["id"])
        self.assertEqual(created.tenant_id, self.tenant.id)
        self.assertEqual(created.created_by, self.user.pk)

    def test_create_without_the_permission_is_403(self) -> None:
        response = self.client.post("/api/v1/staff", self._payload(), format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_a_foreign_campus_id_is_rejected(self) -> None:
        self.allow("staff.staff.create", "staff.staff.view")
        other_tenant = TenantFactory()
        with tenant_context(other_tenant.id):
            foreign_campus = CampusFactory(tenant=other_tenant)

        response = self.client.post(
            "/api/v1/staff", self._payload(campus_id=str(foreign_campus.pk)), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_foreign_department_id_is_rejected(self) -> None:
        self.allow("staff.staff.create", "staff.staff.view")
        other_tenant = TenantFactory()
        with tenant_context(other_tenant.id):
            foreign_department = DepartmentFactory(tenant=other_tenant)

        response = self.client.post(
            "/api/v1/staff", self._payload(department_id=str(foreign_department.pk)), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_foreign_designation_id_is_rejected(self) -> None:
        self.allow("staff.staff.create", "staff.staff.view")
        other_tenant = TenantFactory()
        with tenant_context(other_tenant.id):
            foreign_designation = DesignationFactory(tenant=other_tenant)

        response = self.client.post(
            "/api/v1/staff",
            self._payload(designation_id=str(foreign_designation.pk)),
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class StaffUpdateTests(StaffManagementAPITestCase):
    def _create_staff(self, **overrides):
        with tenant_context(self.tenant.id):
            return StaffFactory(tenant=self.tenant, campus=self.campus, **overrides)

    def test_patching_employee_number_is_rejected(self) -> None:
        self.allow("staff.staff.update", "staff.staff.view")
        staff = self._create_staff()

        response = self.client.patch(
            f"/api/v1/staff/{staff.pk}", {"employee_number": "HACKED"}, format="json"
        )

        # A business-rule violation, not a shape/validation error — the field is
        # syntactically valid, it just cannot change once set (§11).
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(response.json()["error"]["code"], "domain_rule_violation")

    def test_patching_employment_status_directly_is_ignored(self) -> None:
        """employment_status only moves through the :exit action."""
        self.allow("staff.staff.update", "staff.staff.view")
        staff = self._create_staff()

        response = self.client.patch(
            f"/api/v1/staff/{staff.pk}", {"employment_status": "resigned"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["data"]["employment_status"], "active")

    def test_patching_exit_date_directly_is_ignored(self) -> None:
        self.allow("staff.staff.update", "staff.staff.view")
        staff = self._create_staff()

        response = self.client.patch(
            f"/api/v1/staff/{staff.pk}", {"exit_date": "2026-05-01"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.json()["data"]["exit_date"])

    def test_patching_exit_reason_directly_is_ignored(self) -> None:
        self.allow("staff.staff.update", "staff.staff.view")
        staff = self._create_staff()

        response = self.client.patch(
            f"/api/v1/staff/{staff.pk}", {"exit_reason": "Hacked"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.json()["data"]["exit_reason"])


class StaffListTests(StaffManagementAPITestCase):
    def test_filters_by_campus_id(self) -> None:
        self.allow("staff.staff.view")
        with tenant_context(self.tenant.id):
            other_campus = CampusFactory(tenant=self.tenant)
            in_campus = StaffFactory(tenant=self.tenant, campus=self.campus)
            StaffFactory(tenant=self.tenant, campus=other_campus)

        response = self.client.get(f"/api/v1/staff?campus_id={self.campus.pk}")

        ids = {row["id"] for row in response.json()["data"]}
        self.assertEqual(ids, {str(in_campus.pk)})

    def test_filters_by_department_id(self) -> None:
        self.allow("staff.staff.view")
        with tenant_context(self.tenant.id):
            department = DepartmentFactory(tenant=self.tenant)
            other_department = DepartmentFactory(tenant=self.tenant)
            in_department = StaffFactory(
                tenant=self.tenant, campus=self.campus, department=department
            )
            StaffFactory(tenant=self.tenant, campus=self.campus, department=other_department)

        response = self.client.get(f"/api/v1/staff?department_id={department.pk}")

        ids = {row["id"] for row in response.json()["data"]}
        self.assertEqual(ids, {str(in_department.pk)})

    def test_filters_by_designation_id(self) -> None:
        self.allow("staff.staff.view")
        with tenant_context(self.tenant.id):
            designation = DesignationFactory(tenant=self.tenant)
            other_designation = DesignationFactory(tenant=self.tenant)
            in_designation = StaffFactory(
                tenant=self.tenant, campus=self.campus, designation=designation
            )
            StaffFactory(tenant=self.tenant, campus=self.campus, designation=other_designation)

        response = self.client.get(f"/api/v1/staff?designation_id={designation.pk}")

        ids = {row["id"] for row in response.json()["data"]}
        self.assertEqual(ids, {str(in_designation.pk)})

    def test_filters_by_staff_type(self) -> None:
        self.allow("staff.staff.view")
        with tenant_context(self.tenant.id):
            teaching = StaffFactory(tenant=self.tenant, campus=self.campus, staff_type="teaching")
            StaffFactory(tenant=self.tenant, campus=self.campus, staff_type="non_teaching")

        response = self.client.get("/api/v1/staff?staff_type=teaching")

        ids = {row["id"] for row in response.json()["data"]}
        self.assertEqual(ids, {str(teaching.pk)})

    def test_filters_by_employment_status(self) -> None:
        self.allow("staff.staff.view")
        with tenant_context(self.tenant.id):
            active = StaffFactory(tenant=self.tenant, campus=self.campus)
            on_leave = StaffFactory(
                tenant=self.tenant, campus=self.campus, employment_status="on_leave"
            )

        response = self.client.get("/api/v1/staff?employment_status=on_leave")

        ids = {row["id"] for row in response.json()["data"]}
        self.assertEqual(ids, {str(on_leave.pk)})
        self.assertNotIn(str(active.pk), ids)


class StaffOrderingTests(StaffManagementAPITestCase):
    """`?ordering=` on `/staff`, one case per thing the roll can be sorted by.

    Ordering is an allowlist (`StaffViewSet.ordering_fields`), so these tests
    cover both halves of that: the columns that are on it sort, and a column that
    is not is dropped rather than answered with an error.
    """

    def _staff(self, **overrides):
        with tenant_context(self.tenant.id):
            return StaffFactory(tenant=self.tenant, campus=self.campus, **overrides)

    def _last_names(self, query: str) -> list[str]:
        response = self.client.get(f"/api/v1/staff{query}")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return [row["last_name"] for row in response.json()["data"]]

    def test_orders_by_last_name_ascending(self) -> None:
        self.allow("staff.staff.view")
        self._staff(last_name="Yusuf")
        self._staff(last_name="Ahmed")
        self._staff(last_name="Malik")

        self.assertEqual(self._last_names("?ordering=last_name"), ["Ahmed", "Malik", "Yusuf"])

    def test_orders_by_last_name_descending(self) -> None:
        self.allow("staff.staff.view")
        self._staff(last_name="Yusuf")
        self._staff(last_name="Ahmed")
        self._staff(last_name="Malik")

        self.assertEqual(self._last_names("?ordering=-last_name"), ["Yusuf", "Malik", "Ahmed"])

    def test_orders_by_joining_date(self) -> None:
        """Unindexed, and sortable anyway — the roll is bounded by one payroll."""
        self.allow("staff.staff.view")
        self._staff(last_name="Newest", joining_date=datetime.date(2026, 9, 1))
        self._staff(last_name="Oldest", joining_date=datetime.date(2020, 1, 15))

        self.assertEqual(self._last_names("?ordering=joining_date"), ["Oldest", "Newest"])
        self.assertEqual(self._last_names("?ordering=-joining_date"), ["Newest", "Oldest"])

    def test_orders_by_the_designation_it_belongs_to(self) -> None:
        """The annotated related sort — `designation_name`, never `designation__name`."""
        self.allow("staff.staff.view")
        with tenant_context(self.tenant.id):
            alpha = DesignationFactory(tenant=self.tenant, name="Alpha")
            mike = DesignationFactory(tenant=self.tenant, name="Mike")
            zulu = DesignationFactory(tenant=self.tenant, name="Zulu")
        self._staff(last_name="Third", designation=zulu)
        self._staff(last_name="First", designation=alpha)
        self._staff(last_name="Second", designation=mike)

        self.assertEqual(
            self._last_names("?ordering=designation_name"), ["First", "Second", "Third"]
        )
        self.assertEqual(
            self._last_names("?ordering=-designation_name"), ["Third", "Second", "First"]
        )

    def test_orders_by_the_campus_it_belongs_to(self) -> None:
        self.allow("staff.staff.view")
        with tenant_context(self.tenant.id):
            north = CampusFactory(tenant=self.tenant, name="North")
            south = CampusFactory(tenant=self.tenant, name="South")
            StaffFactory(tenant=self.tenant, campus=south, last_name="Later")
            StaffFactory(tenant=self.tenant, campus=north, last_name="Earlier")

        self.assertEqual(self._last_names("?ordering=campus_name"), ["Earlier", "Later"])

    def test_an_undeclared_ordering_field_is_ignored_rather_than_an_error(self) -> None:
        """`phone` is on the serializer, so DRF would have taken it with no allowlist.

        With one, the parameter is dropped and the model's own ordering stands —
        a 200 in the default order, never a 400.
        """
        self.allow("staff.staff.view")
        self._staff(last_name="Ahmed", phone="+923009999999")
        self._staff(last_name="Yusuf", phone="+923000000001")

        # Staff.Meta.ordering, not the descending-phone order the parameter asked for.
        self.assertEqual(self._last_names("?ordering=phone"), ["Ahmed", "Yusuf"])


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


class OwnScopeTests(StaffManagementAPITestCase):
    def test_own_scope_staff_member_sees_only_themself(self) -> None:
        from django.core.cache import cache

        from core.rbac.models import Permission, RecordScope, Role, RolePermission, UserRole

        with tenant_context(self.tenant.id):
            own_staff = StaffFactory(tenant=self.tenant, campus=self.campus, user_id=self.user.pk)
            StaffFactory(tenant=self.tenant, campus=self.campus)  # someone else's record

        role = Role.objects.create(tenant=self.tenant, slug="test-own-scope", name="Own scope")
        permission, _ = Permission.objects.get_or_create(
            key="staff.staff.view",
            defaults={"module": "staff", "resource": "staff", "action": "view"},
        )
        RolePermission.objects.create(role=role, permission=permission)
        UserRole.objects.create(
            user=self.user, role=role, tenant=self.tenant, scope=RecordScope.OWN
        )
        cache.delete(f"perm-keys:{self.user.pk}")

        response = self.client.get("/api/v1/staff")

        ids = {row["id"] for row in response.json()["data"]}
        self.assertEqual(ids, {str(own_staff.pk)})
