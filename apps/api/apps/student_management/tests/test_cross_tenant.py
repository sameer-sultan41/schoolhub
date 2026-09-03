"""Cross-tenant isolation for every student-management endpoint.

The assertion is always **404, never 403**: a 403 on another tenant's record
confirms the record exists, which is itself a leak. The acting user is granted
*every* key this module declares (plus the module feature flag), so a 403 here
could only mean a leak of existence, never a missing permission — matching
school_organization/tests/test_cross_tenant.py's harness exactly.
"""

from __future__ import annotations

from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import (
    CampusFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.student_management.models import Student
from apps.student_management.tests.factories import StudentFactory, enable_feature
from core.rbac.registry import registry
from core.tenancy.context import tenant_context


class CrossTenantAccessTests(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant_a = TenantFactory()
        self.tenant_b = TenantFactory()

        self.user = UserFactory(tenant=self.tenant_a)
        grant(self.user, *(spec.key for spec in registry.for_module("students")))
        authenticate(self.client, self.user)
        enable_feature(self.tenant_a, "module.students")
        enable_feature(self.tenant_b, "module.students")

        self.foreign = self._build_structure(self.tenant_b)
        self.own = self._build_structure(self.tenant_a)

    @staticmethod
    def _build_structure(tenant) -> dict[str, object]:
        with tenant_context(tenant.id):
            campus = CampusFactory(tenant=tenant)
            student = StudentFactory(tenant=tenant, campus=campus)
        return {"students": student, "_campus": campus}

    def test_retrieving_another_tenants_record_is_404(self) -> None:
        response = self.client.get(f"/api/v1/students/{self.foreign['students'].pk}")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_patching_another_tenants_record_is_404(self) -> None:
        response = self.client.patch(
            f"/api/v1/students/{self.foreign['students'].pk}",
            {"first_name": "Hijacked"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_deleting_another_tenants_record_is_404(self) -> None:
        response = self.client.delete(f"/api/v1/students/{self.foreign['students'].pk}")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_lists_never_include_another_tenants_rows(self) -> None:
        response = self.client.get("/api/v1/students")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        returned = {row["id"] for row in response.json()["data"]}
        self.assertEqual(returned, {str(self.own["students"].pk)})
        self.assertNotIn(str(self.foreign["students"].pk), returned)

    def test_the_same_routes_succeed_for_the_callers_own_records(self) -> None:
        """Positive control: the 404s above are isolation, not a broken route table."""
        response = self.client.get(f"/api/v1/students/{self.own['students'].pk}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["data"]["id"], str(self.own["students"].pk))

    def test_a_foreign_campus_id_cannot_be_smuggled_into_a_create(self) -> None:
        response = self.client.post(
            "/api/v1/students",
            {
                "first_name": "Smuggled",
                "last_name": "Student",
                "date_of_birth": "2015-06-01",
                "gender": "other",
                "campus_id": str(self.foreign["_campus"].pk),
                "admission_date": "2026-04-01",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_foreign_user_id_cannot_be_smuggled_into_a_patch(self) -> None:
        with tenant_context(self.tenant_b.id):
            foreign_user = UserFactory(tenant=self.tenant_b)

        response = self.client.patch(
            f"/api/v1/students/{self.own['students'].pk}",
            {"user_id": str(foreign_user.pk)},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        with tenant_context(self.tenant_a.id):
            self.own["students"].refresh_from_db()
        self.assertIsNone(self.own["students"].user_id)

    def test_a_write_never_lands_in_another_tenant(self) -> None:
        response = self.client.post(
            "/api/v1/students",
            {
                "first_name": "Owned",
                "last_name": "Student",
                "date_of_birth": "2015-06-01",
                "gender": "other",
                "campus_id": str(self.own["_campus"].pk),
                "admission_date": "2026-04-01",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        created_id = response.json()["data"]["id"]

        with tenant_context(self.tenant_a.id):
            created = Student.objects.get(pk=created_id)
        self.assertEqual(created.tenant_id, self.tenant_a.id)

        with tenant_context(self.tenant_b.id):
            self.assertFalse(Student.objects.filter(pk=created_id).exists())
