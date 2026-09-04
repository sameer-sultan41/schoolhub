"""Cross-tenant isolation for every staff-management endpoint.

The assertion is always **404, never 403**: a 403 on another tenant's record
confirms the record exists, which is itself a leak. The acting user is granted
*every* key this module declares (plus the module feature flag), so a 403 here
could only mean a leak of existence, never a missing permission — matching
student_management/tests/test_cross_tenant.py's harness exactly.
"""

from __future__ import annotations

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
    DesignationFactory,
    FileFactory,
    StaffDocumentFactory,
    StaffFactory,
    StaffQualificationFactory,
    enable_feature,
)
from core.rbac.registry import registry
from core.tenancy.context import tenant_context


class CrossTenantAccessTests(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant_a = TenantFactory()
        self.tenant_b = TenantFactory()

        self.user = UserFactory(tenant=self.tenant_a)
        grant(self.user, *(spec.key for spec in registry.for_module("staff")))
        authenticate(self.client, self.user)
        enable_feature(self.tenant_a, "module.staff")
        enable_feature(self.tenant_b, "module.staff")

        self.foreign = self._build_structure(self.tenant_b)
        self.own = self._build_structure(self.tenant_a)

    @staticmethod
    def _build_structure(tenant) -> dict[str, object]:
        with tenant_context(tenant.id):
            campus = CampusFactory(tenant=tenant)
            department = DepartmentFactory(tenant=tenant)
            designation = DesignationFactory(tenant=tenant)
            user = UserFactory(tenant=tenant)
            manager = StaffFactory(tenant=tenant, campus=campus)
            staff = StaffFactory(
                tenant=tenant,
                campus=campus,
                department=department,
                designation=designation,
                reports_to=manager,
            )
        return {
            "staff": staff,
            "manager": manager,
            "_campus": campus,
            "_department": department,
            "_designation": designation,
            "_user": user,
        }

    def _payload(self, **overrides) -> dict:
        payload = {
            "first_name": "Smuggled",
            "last_name": "Staff",
            "staff_type": "teaching",
            "campus_id": str(self.own["_campus"].pk),
            "joining_date": "2026-04-01",
            "phone": "+923001234567",
        }
        payload.update(overrides)
        return payload

    def test_retrieving_another_tenants_record_is_404(self) -> None:
        response = self.client.get(f"/api/v1/staff/{self.foreign['staff'].pk}")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_patching_another_tenants_record_is_404(self) -> None:
        response = self.client.patch(
            f"/api/v1/staff/{self.foreign['staff'].pk}", {"first_name": "Hijacked"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_deleting_another_tenants_record_is_404(self) -> None:
        response = self.client.delete(f"/api/v1/staff/{self.foreign['staff'].pk}")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_lists_never_include_another_tenants_rows(self) -> None:
        response = self.client.get("/api/v1/staff")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        returned = {row["id"] for row in response.json()["data"]}
        self.assertIn(str(self.own["staff"].pk), returned)
        self.assertNotIn(str(self.foreign["staff"].pk), returned)

    def test_the_same_routes_succeed_for_the_callers_own_records(self) -> None:
        """Positive control: the 404s above are isolation, not a broken route table."""
        response = self.client.get(f"/api/v1/staff/{self.own['staff'].pk}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["data"]["id"], str(self.own["staff"].pk))

    def test_a_foreign_campus_id_cannot_be_smuggled_into_a_create(self) -> None:
        response = self.client.post(
            "/api/v1/staff", self._payload(campus_id=str(self.foreign["_campus"].pk)), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_foreign_department_id_cannot_be_smuggled_into_a_create(self) -> None:
        response = self.client.post(
            "/api/v1/staff",
            self._payload(department_id=str(self.foreign["_department"].pk)),
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_foreign_designation_id_cannot_be_smuggled_into_a_create(self) -> None:
        response = self.client.post(
            "/api/v1/staff",
            self._payload(designation_id=str(self.foreign["_designation"].pk)),
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_foreign_reports_to_staff_id_cannot_be_smuggled_into_a_create(self) -> None:
        response = self.client.post(
            "/api/v1/staff",
            self._payload(reports_to_staff_id=str(self.foreign["manager"].pk)),
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_foreign_user_id_cannot_be_smuggled_into_a_patch(self) -> None:
        response = self.client.patch(
            f"/api/v1/staff/{self.own['staff'].pk}",
            {"user_id": str(self.foreign["_user"].pk)},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        with tenant_context(self.tenant_a.id):
            self.own["staff"].refresh_from_db()
        self.assertIsNone(self.own["staff"].user_id)

    def test_a_foreign_reports_to_staff_id_cannot_be_smuggled_into_a_patch(self) -> None:
        response = self.client.patch(
            f"/api/v1/staff/{self.own['staff'].pk}",
            {"reports_to_staff_id": str(self.foreign["manager"].pk)},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_write_never_lands_in_another_tenant(self) -> None:
        response = self.client.post("/api/v1/staff", self._payload(), format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        created_id = response.json()["data"]["id"]

        with tenant_context(self.tenant_a.id):
            created = Staff.objects.get(pk=created_id)
        self.assertEqual(created.tenant_id, self.tenant_a.id)

        with tenant_context(self.tenant_b.id):
            self.assertFalse(Staff.objects.filter(pk=created_id).exists())

    def test_nested_qualifications_under_a_foreign_staff_is_404(self) -> None:
        response = self.client.get(f"/api/v1/staff/{self.foreign['staff'].pk}/qualifications")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_nested_documents_under_a_foreign_staff_is_404(self) -> None:
        response = self.client.get(f"/api/v1/staff/{self.foreign['staff'].pk}/documents")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_inviting_another_tenants_staff_is_404(self) -> None:
        response = self.client.post(
            f"/api/v1/staff/{self.foreign['staff'].pk}:invite", {"role_ids": []}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_exiting_another_tenants_staff_is_404(self) -> None:
        response = self.client.post(
            f"/api/v1/staff/{self.foreign['staff'].pk}:exit",
            {"exit_date": "2026-04-01", "exit_reason": "resigned"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_verifying_another_tenants_qualification_is_404(self) -> None:
        with tenant_context(self.tenant_b.id):
            qualification = StaffQualificationFactory(
                tenant=self.tenant_b, staff=self.foreign["staff"]
            )
        response = self.client.post(
            f"/api/v1/staff-qualifications/{qualification.pk}:verify",
            {"decision": "verified"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_verifying_another_tenants_document_is_404(self) -> None:
        with tenant_context(self.tenant_b.id):
            file = FileFactory(tenant=self.tenant_b)
            document = StaffDocumentFactory(
                tenant=self.tenant_b, staff=self.foreign["staff"], file=file
            )
        response = self.client.post(
            f"/api/v1/staff-documents/{document.pk}:verify",
            {"decision": "verified"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
