"""Cross-tenant isolation for every school-organization endpoint.

The assertion is always **404, never 403**: a 403 on another tenant's record
confirms that the record exists, which is itself a leak (security.md §4.2,
ENGINEERING_STANDARDS §4.2). The acting user is granted *every* key this module
declares, so a 403 here could only mean a leak of existence, never a missing
permission.
"""

from __future__ import annotations

from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.models import Campus
from apps.school_organization.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    DepartmentFactory,
    HouseFactory,
    SectionFactory,
    SubjectFactory,
    TenantFactory,
    TermFactory,
    UserFactory,
    authenticate,
    grant,
)
from core.rbac.registry import registry
from core.tenancy.context import tenant_context

# Resources that expose DELETE. Sessions and terms are closed, not deleted (§16).
#
# `class-subjects` is absent although this module still owns the *table*: the
# endpoint moved to academics in the same PR that added it, so its cross-tenant
# sweep lives in `apps/academics/tests/test_cross_tenant.py` where the keys and
# the feature flag it now needs are granted.
DELETABLE = frozenset({"campuses", "departments", "classes", "sections", "subjects", "houses"})


class CrossTenantAccessTests(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant_a = TenantFactory()
        self.tenant_b = TenantFactory()

        self.user = UserFactory(tenant=self.tenant_a)
        grant(self.user, *(spec.key for spec in registry.for_module("school")))
        authenticate(self.client, self.user)

        self.foreign = self._build_structure(self.tenant_b)
        self.own = self._build_structure(self.tenant_a)

    @staticmethod
    def _build_structure(tenant) -> dict[str, object]:
        """One row per table this module owns, for a single tenant."""
        with tenant_context(tenant.id):
            campus = CampusFactory(tenant=tenant)
            department = DepartmentFactory(tenant=tenant, campus=campus)
            session = AcademicSessionFactory(tenant=tenant)
            term = TermFactory(tenant=tenant, academic_session=session)
            grade = ClassFactory(tenant=tenant)
            section = SectionFactory(tenant=tenant, school_class=grade, campus=campus)
            subject = SubjectFactory(tenant=tenant, department=department)
            house = HouseFactory(tenant=tenant)

        return {
            "campuses": campus,
            "departments": department,
            "academic-sessions": session,
            "terms": term,
            "classes": grade,
            "sections": section,
            "subjects": subject,
            "houses": house,
        }

    def test_retrieving_another_tenants_record_is_404(self) -> None:
        for resource, instance in self.foreign.items():
            with self.subTest(resource=resource):
                response = self.client.get(f"/api/v1/{resource}/{instance.pk}")
                self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_patching_another_tenants_record_is_404(self) -> None:
        for resource, instance in self.foreign.items():
            with self.subTest(resource=resource):
                response = self.client.patch(
                    f"/api/v1/{resource}/{instance.pk}", {"name": "Hijacked"}, format="json"
                )
                self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_deleting_another_tenants_record_is_404(self) -> None:
        for resource in DELETABLE:
            with self.subTest(resource=resource):
                instance = self.foreign[resource]
                response = self.client.delete(f"/api/v1/{resource}/{instance.pk}")
                self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_session_colon_actions_on_another_tenant_are_404(self) -> None:
        session = self.foreign["academic-sessions"]
        bodies = {
            "activate": {},
            "close": {},
            "clone": {
                "name": "Stolen",
                "start_date": "2030-04-01",
                "end_date": "2031-03-31",
            },
        }
        for action, body in bodies.items():
            with self.subTest(action=action):
                response = self.client.post(
                    f"/api/v1/academic-sessions/{session.pk}:{action}", body, format="json"
                )
                self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_lists_never_include_another_tenants_rows(self) -> None:
        for resource, instance in self.own.items():
            with self.subTest(resource=resource):
                response = self.client.get(f"/api/v1/{resource}")
                self.assertEqual(response.status_code, status.HTTP_200_OK)

                returned = {row["id"] for row in response.json()["data"]}
                self.assertEqual(returned, {str(instance.pk)})
                self.assertNotIn(str(self.foreign[resource].pk), returned)

    def test_the_same_routes_succeed_for_the_callers_own_records(self) -> None:
        """Positive control: the 404s above are isolation, not a broken route table."""
        for resource, instance in self.own.items():
            with self.subTest(resource=resource):
                response = self.client.get(f"/api/v1/{resource}/{instance.pk}")
                self.assertEqual(response.status_code, status.HTTP_200_OK)
                self.assertEqual(response.json()["data"]["id"], str(instance.pk))

    def test_a_foreign_foreign_key_cannot_be_smuggled_into_a_create(self) -> None:
        """A tenant-scoped related field must not resolve another tenant's id."""
        response = self.client.post(
            "/api/v1/sections",
            {
                "class_id": str(self.foreign["classes"].pk),
                "campus_id": str(self.foreign["campuses"].pk),
                "name": "Smuggled",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_foreign_staff_id_cannot_be_smuggled_into_head_staff_id(self) -> None:
        """`head_staff_id`/`class_teacher_staff_id`/`house_master_staff_id` are

        plain UUID columns, not ForeignKeys (same reasoning as
        student_management's `user_id`) — this is the regression test for the
        review finding that they previously had no ownership check at all.
        """
        from apps.staff_management.tests.factories import StaffFactory

        with tenant_context(self.tenant_b.id):
            foreign_staff = StaffFactory(tenant=self.tenant_b, campus=self.foreign["campuses"])

        cases = {
            "campuses": ("head_staff_id", self.own["campuses"]),
            "departments": ("head_staff_id", self.own["departments"]),
            "sections": ("class_teacher_staff_id", self.own["sections"]),
            "houses": ("house_master_staff_id", self.own["houses"]),
        }
        for resource, (field, instance) in cases.items():
            with self.subTest(resource=resource):
                response = self.client.patch(
                    f"/api/v1/{resource}/{instance.pk}",
                    {field: str(foreign_staff.pk)},
                    format="json",
                )
                self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
                with tenant_context(self.tenant_a.id):
                    instance.refresh_from_db()
                self.assertIsNone(getattr(instance, field))

    def test_a_write_never_lands_in_another_tenant(self) -> None:
        response = self.client.post(
            "/api/v1/campuses", {"name": "Owned", "code": "OWNED"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        with tenant_context(self.tenant_a.id):
            created = Campus.objects.get(code="OWNED")
        self.assertEqual(created.tenant_id, self.tenant_a.id)

        with tenant_context(self.tenant_b.id):
            self.assertFalse(Campus.objects.filter(code="OWNED").exists())
