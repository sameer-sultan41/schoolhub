"""API-level tests for the student-management module.

URLs are literal strings, not ``reverse()`` — the URL *is* the contract (see
school_organization/tests/test_api.py's identical convention).
"""

from __future__ import annotations

import datetime

from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import (
    CampusFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.student_management.models import StudentStatus
from apps.student_management.tests.factories import (
    DEFAULT_ADMISSION_DATE,
    DEFAULT_DOB,
    GuardianFactory,
    HouseFactory,
    StudentFactory,
    StudentGuardianFactory,
    enable_feature,
)
from core.rbac.models import RecordScope
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
        from core.tenancy.models import TenantFeatureOverride

        self.allow("students.student.view")
        with tenant_context(self.tenant.id):
            TenantFeatureOverride.objects.filter(tenant=self.tenant).delete()
            from core.tenancy.models import FeatureFlag

            flag = FeatureFlag.objects.get(key="module.students")
            TenantFeatureOverride.objects.create(
                tenant=self.tenant, feature_flag=flag, enabled=False, reason="test"
            )

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

    def test_a_misconfigured_admission_number_pattern_is_rejected_with_a_clear_error(self) -> None:
        from core.tenancy.models import TenantSettings

        self.allow("students.student.create", "students.student.view")
        TenantSettings.all_tenants.create(
            tenant=self.tenant, academic={"admission_number_pattern": "{campus}-{seq:2d}"}
        )

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

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(response.json()["error"]["code"], "domain_rule_violation")

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

        # A business-rule violation, not a shape/validation error — the field is
        # syntactically valid, it just cannot change once set (§11).
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(response.json()["error"]["code"], "domain_rule_violation")

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


class StudentListTotalCountTests(StudentManagementAPITestCase):
    """`/students` is page-numbered (core/api/pagination.py), so it reports a total.

    A roll is a bounded set that staff, and the dashboard, ask the size of constantly —
    and one navigated by position, which is why it pages by number rather than by
    cursor. These tests pin the two things that make the total worth having: that it is
    the size of the WHOLE narrowed set rather than of the page, and that it narrows with
    the same filters and scopes the rows do.
    """

    def test_the_total_is_the_whole_set_not_the_page(self) -> None:
        self.allow("students.student.view")
        with tenant_context(self.tenant.id):
            for _ in range(5):
                StudentFactory(tenant=self.tenant, campus=self.campus)

        response = self.client.get("/api/v1/students?page_size=2")

        body = response.json()
        self.assertEqual(len(body["data"]), 2)
        self.assertEqual(body["meta"]["pagination"]["total_count"], 5)

    def test_the_total_narrows_with_the_filters(self) -> None:
        """A count that ignores the filters is worse than no count — it contradicts the
        rows the reader is looking at."""
        self.allow("students.student.view")
        with tenant_context(self.tenant.id):
            other_campus = CampusFactory(tenant=self.tenant)
            StudentFactory(tenant=self.tenant, campus=self.campus)
            for _ in range(3):
                StudentFactory(tenant=self.tenant, campus=other_campus)

        response = self.client.get(f"/api/v1/students?campus_id={other_campus.pk}")

        self.assertEqual(response.json()["meta"]["pagination"]["total_count"], 3)

    def test_soft_deleted_students_are_not_counted(self) -> None:
        self.allow("students.student.view", "students.student.delete")
        with tenant_context(self.tenant.id):
            kept = StudentFactory(tenant=self.tenant, campus=self.campus)
            removed = StudentFactory(tenant=self.tenant, campus=self.campus)

        self.client.delete(f"/api/v1/students/{removed.pk}")
        response = self.client.get("/api/v1/students")

        body = response.json()
        self.assertEqual(body["meta"]["pagination"]["total_count"], 1)
        self.assertEqual({row["id"] for row in body["data"]}, {str(kept.pk)})


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


class StudentOrderingTests(StudentManagementAPITestCase):
    """`?ordering=` on `/students` — every column the roll renders is sortable.

    The three rows below differ in every one of those columns, so each expected order
    is a strict permutation with no ties for `StableOrderingFilter`'s pk tiebreak to
    decide — a passing assertion here is the sort working, not a coincidence.
    """

    def setUp(self) -> None:
        super().setUp()
        self.allow("students.student.view")
        with tenant_context(self.tenant.id):
            aurora = CampusFactory(tenant=self.tenant, name="Aurora Campus")
            borealis = CampusFactory(tenant=self.tenant, name="Borealis Campus")
            cygnus = CampusFactory(tenant=self.tenant, name="Cygnus Campus")
            falcon = HouseFactory(tenant=self.tenant, name="Falcon")
            osprey = HouseFactory(tenant=self.tenant, name="Osprey")
            self.sethi = StudentFactory(
                tenant=self.tenant,
                campus=aurora,
                house=osprey,
                admission_number="ADM-001",
                first_name="Ama",
                last_name="Sethi",
                admission_date=datetime.date(2026, 1, 15),
                date_of_birth=datetime.date(2016, 2, 1),
                status=StudentStatus.ACTIVE,
                nationality="Bolivia",
            )
            self.zheng = StudentFactory(
                tenant=self.tenant,
                campus=borealis,
                house=falcon,
                admission_number="ADM-002",
                first_name="Kai",
                last_name="Zheng",
                admission_date=datetime.date(2026, 2, 20),
                date_of_birth=datetime.date(2014, 5, 11),
                status=StudentStatus.SUSPENDED,
                nationality="Argentina",
            )
            self.raza = StudentFactory(
                tenant=self.tenant,
                campus=cygnus,
                # No house: `house_name` is the nullable one of the two annotations.
                house=None,
                admission_number="ADM-003",
                first_name="Zara",
                last_name="Raza",
                admission_date=datetime.date(2026, 3, 1),
                date_of_birth=datetime.date(2015, 9, 30),
                status=StudentStatus.WITHDRAWN,
                nationality="Chile",
            )

    def ids(self, query: str) -> list[str]:
        response = self.client.get(f"/api/v1/students?{query}")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return [row["id"] for row in response.json()["data"]]

    def ascending(self) -> dict[str, tuple]:
        return {
            "last_name": (self.raza, self.sethi, self.zheng),
            "first_name": (self.sethi, self.zheng, self.raza),
            "admission_number": (self.sethi, self.zheng, self.raza),
            "admission_date": (self.sethi, self.zheng, self.raza),
            # active, suspended, withdrawn — the stored values, not the labels.
            "status": (self.sethi, self.zheng, self.raza),
            "date_of_birth": (self.zheng, self.raza, self.sethi),
            "campus_name": (self.sethi, self.zheng, self.raza),
            # Falcon, Osprey, then the student in no house: `house` is nullable and
            # Postgres sorts NULL last ascending.
            "house_name": (self.zheng, self.sethi, self.raza),
        }

    def test_each_column_the_roll_renders_sorts_ascending(self) -> None:
        for field, students in self.ascending().items():
            with self.subTest(field=field):
                self.assertEqual(self.ids(f"ordering={field}"), [str(s.pk) for s in students])

    def test_the_same_columns_sort_descending(self) -> None:
        for field, students in self.ascending().items():
            with self.subTest(field=field):
                self.assertEqual(
                    self.ids(f"ordering=-{field}"), [str(s.pk) for s in reversed(students)]
                )

    def test_a_guardian_can_sort_their_own_children_by_house(self) -> None:
        """The `.distinct()` case the no-`__` rule exists for.

        `Student.filter_owned_by_user` joins through `student_guardians` and ends in
        `.distinct()`. Postgres refuses `SELECT DISTINCT` with an `ORDER BY` on a
        joined column that is not in the select list, so `house__name` in
        `ordering_fields` would answer 200 for the admin above and raise
        ProgrammingError for exactly this reader. The annotation is in the select list.
        """
        user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            guardian = GuardianFactory(tenant=self.tenant, user_id=user.pk)
            StudentGuardianFactory(tenant=self.tenant, student=self.sethi, guardian=guardian)
            StudentGuardianFactory(tenant=self.tenant, student=self.zheng, guardian=guardian)
        grant(user, "students.student.view", scope=RecordScope.OWN)
        authenticate(self.client, user)

        self.assertEqual(self.ids("ordering=house_name"), [str(self.zheng.pk), str(self.sethi.pk)])
        # The other annotation, and the opposite order — so a sort that silently did
        # nothing could not pass both assertions.
        self.assertEqual(self.ids("ordering=campus_name"), [str(self.sethi.pk), str(self.zheng.pk)])

    def test_an_undeclared_column_is_ignored_rather_than_an_error(self) -> None:
        """`nationality` is a real column left out of the allowlist. DRF drops an
        unlisted term silently rather than answering 400, so the client that sent it
        still gets a usable list — in the view's own default order. Honouring it would
        have put Zheng first."""
        self.assertEqual(
            self.ids("ordering=nationality"),
            [str(self.raza.pk), str(self.sethi.pk), str(self.zheng.pk)],
        )
