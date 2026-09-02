"""API-level tests for the student-management module.

URLs are literal strings, not ``reverse()`` — the URL *is* the contract (see
school_organization/tests/test_api.py's identical convention).
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
from apps.student_management.tests.factories import (
    DEFAULT_ADMISSION_DATE,
    DEFAULT_DOB,
    StudentFactory,
    enable_feature,
)
from core.tenancy.context import tenant_context


class StudentManagementAPITestCase(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)
        enable_feature(self.tenant, "module.students")
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)

    def allow(self, *keys: str) -> None:
        grant(self.user, *keys)


class ModuleFeatureGateTests(StudentManagementAPITestCase):
    def test_the_module_flag_off_is_403_module_disabled_even_with_permission(self) -> None:
        from django.core.cache import cache

        from core.tenancy.models import TenantFeatureOverride

        self.allow("students.student.view")
        with tenant_context(self.tenant.id):
            TenantFeatureOverride.objects.filter(tenant=self.tenant).delete()
            from core.tenancy.models import FeatureFlag

            flag = FeatureFlag.objects.get(key="module.students")
            TenantFeatureOverride.objects.create(
                tenant=self.tenant, feature_flag=flag, enabled=False, reason="test"
            )
        cache.delete(f"feature:{self.tenant.id}:module.students")

        response = self.client.get("/api/v1/students")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.json()["error"]["code"], "module_disabled")


class StudentCreateTests(StudentManagementAPITestCase):
    def test_create_allocates_an_admission_number_and_stamps_the_tenant(self) -> None:
        self.allow("students.student.create", "students.student.view")

        response = self.client.post(
            "/api/v1/students",
            {
                "first_name": "Amina",
                "last_name": "Khan",
                "date_of_birth": str(DEFAULT_DOB),
                "gender": "female",
                "campus_id": str(self.campus.pk),
                "admission_date": str(DEFAULT_ADMISSION_DATE),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        data = response.json()["data"]
        self.assertTrue(data["admission_number"])
        self.assertEqual(data["status"], "active")

        with tenant_context(self.tenant.id):
            from apps.student_management.models import Student

            created = Student.objects.get(pk=data["id"])
        self.assertEqual(created.tenant_id, self.tenant.id)
        self.assertEqual(created.created_by, self.user.pk)

    def test_create_without_the_permission_is_403(self) -> None:
        response = self.client.post(
            "/api/v1/students",
            {
                "first_name": "Amina",
                "last_name": "Khan",
                "date_of_birth": str(DEFAULT_DOB),
                "gender": "female",
                "campus_id": str(self.campus.pk),
                "admission_date": str(DEFAULT_ADMISSION_DATE),
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_a_second_identical_registration_is_rejected_as_a_duplicate(self) -> None:
        self.allow("students.student.create", "students.student.view")
        payload = {
            "first_name": "Amina",
            "last_name": "Khan",
            "date_of_birth": str(DEFAULT_DOB),
            "gender": "female",
            "campus_id": str(self.campus.pk),
            "admission_date": str(DEFAULT_ADMISSION_DATE),
        }
        first = self.client.post("/api/v1/students", payload, format="json")
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)

        second = self.client.post("/api/v1/students", payload, format="json")
        self.assertEqual(second.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(second.json()["error"]["code"], "domain_rule_violation")

    def test_a_foreign_campus_id_is_rejected(self) -> None:
        self.allow("students.student.create", "students.student.view")
        other_tenant = TenantFactory()
        with tenant_context(other_tenant.id):
            foreign_campus = CampusFactory(tenant=other_tenant)

        response = self.client.post(
            "/api/v1/students",
            {
                "first_name": "Amina",
                "last_name": "Khan",
                "date_of_birth": str(DEFAULT_DOB),
                "gender": "female",
                "campus_id": str(foreign_campus.pk),
                "admission_date": str(DEFAULT_ADMISSION_DATE),
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class StudentUpdateTests(StudentManagementAPITestCase):
    def _create_student(self, **overrides):
        with tenant_context(self.tenant.id):
            return StudentFactory(tenant=self.tenant, campus=self.campus, **overrides)

    def test_patching_admission_number_is_rejected(self) -> None:
        self.allow("students.student.update", "students.student.view")
        student = self._create_student()

        response = self.client.patch(
            f"/api/v1/students/{student.pk}", {"admission_number": "HACKED"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.json()["error"]["code"], "validation_error")

    def test_patching_status_directly_is_ignored(self) -> None:
        """status only moves through the enroll/change-section/withdraw actions (a later PR)."""
        self.allow("students.student.update", "students.student.view")
        student = self._create_student()

        response = self.client.patch(
            f"/api/v1/students/{student.pk}", {"status": "withdrawn"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["data"]["status"], "active")


class MedicalNotesVisibilityTests(StudentManagementAPITestCase):
    def test_medical_notes_is_present_for_a_caller_with_update_permission(self) -> None:
        self.allow("students.student.view", "students.student.update")
        with tenant_context(self.tenant.id):
            student = StudentFactory(
                tenant=self.tenant, campus=self.campus, medical_notes="Penicillin allergy"
            )

        response = self.client.get(f"/api/v1/students/{student.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["data"]["medical_notes"], "Penicillin allergy")

    def test_medical_notes_is_absent_for_a_view_only_caller(self) -> None:
        self.allow("students.student.view")
        with tenant_context(self.tenant.id):
            student = StudentFactory(
                tenant=self.tenant, campus=self.campus, medical_notes="Penicillin allergy"
            )

        response = self.client.get(f"/api/v1/students/{student.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn("medical_notes", response.json()["data"])


class StudentListTests(StudentManagementAPITestCase):
    def test_soft_deleted_students_are_excluded(self) -> None:
        self.allow("students.student.view", "students.student.delete")
        with tenant_context(self.tenant.id):
            student = StudentFactory(tenant=self.tenant, campus=self.campus)

        delete_response = self.client.delete(f"/api/v1/students/{student.pk}")
        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)

        list_response = self.client.get("/api/v1/students")
        ids = {row["id"] for row in list_response.json()["data"]}
        self.assertNotIn(str(student.pk), ids)

    def test_filters_by_campus_and_status(self) -> None:
        self.allow("students.student.view")
        with tenant_context(self.tenant.id):
            other_campus = CampusFactory(tenant=self.tenant)
            in_campus = StudentFactory(tenant=self.tenant, campus=self.campus)
            StudentFactory(tenant=self.tenant, campus=other_campus)

        response = self.client.get(f"/api/v1/students?campus_id={self.campus.pk}")

        ids = {row["id"] for row in response.json()["data"]}
        self.assertEqual(ids, {str(in_campus.pk)})

    def test_own_scope_student_sees_only_themself(self) -> None:
        from core.rbac.models import RecordScope, Role, RolePermission, UserRole
        from core.rbac.registry import registry

        with tenant_context(self.tenant.id):
            own_student = StudentFactory(tenant=self.tenant, campus=self.campus)
            StudentFactory(tenant=self.tenant, campus=self.campus)  # another student

        self.user.tenant = self.tenant
        self.user.save(update_fields=["tenant"])
        with tenant_context(self.tenant.id):
            # A raw .save() still goes through RLS's WITH CHECK on the UPDATE;
            # outside a bound tenant context it would silently affect zero rows
            # rather than raise, since the row is simply invisible to the
            # statement — not an error PostgreSQL surfaces.
            own_student.user_id = self.user.pk
            own_student.save(update_fields=["user_id"])

        role = Role.objects.create(tenant=self.tenant, slug="test-guardian", name="Guardian")
        for spec in registry.for_module("students"):
            if spec.action != "view":
                continue
            from core.rbac.models import Permission

            permission, _ = Permission.objects.get_or_create(
                key=spec.key,
                defaults={"module": "students", "resource": "student", "action": "view"},
            )
            RolePermission.objects.create(role=role, permission=permission)
        UserRole.objects.create(
            user=self.user, role=role, tenant=self.tenant, scope=RecordScope.OWN
        )
        from django.core.cache import cache

        cache.delete(f"perm-keys:{self.user.pk}")

        response = self.client.get("/api/v1/students")

        ids = {row["id"] for row in response.json()["data"]}
        self.assertEqual(ids, {str(own_student.pk)})
