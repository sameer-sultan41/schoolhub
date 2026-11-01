"""Record scope `own` on students — both principals it has to cover.

`scope_queryset` used to filter `RecordScope.OWN` as `students.user_id == user.pk`
and nothing else, so a guardian's portal account matched no student at all: "a
guardian can see only their own child's record" was not enforced, it simply
returned nothing while looking like it worked. `Student.filter_owned_by_user` is
the hook that fixes it; these are the assertions that keep it fixed.
"""

from __future__ import annotations

from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    SectionFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.staff_management.tests.factories import StaffFactory
from apps.student_management.tests.factories import (
    GuardianFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    StudentGuardianFactory,
    enable_feature,
)
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

VIEW_KEY = "students.student.view"
UPDATE_KEY = "students.student.update"
# A key no student route declares: the unrelated `all` role a mixed user holds.
UNRELATED = "exams.exam.view"
NOTES = "Penicillin allergy"


class StudentOwnScopeTests(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        enable_feature(self.tenant, "module.students")
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.own_child = StudentFactory(tenant=self.tenant, campus=self.campus)
            self.other_child = StudentFactory(tenant=self.tenant, campus=self.campus)

    def _guardian_for(self, user):
        """One `Guardian` row per user, reused across links.

        `guardians_unique_user_per_tenant` allows a user exactly one guardian
        record per tenant — which is the real shape: one guardian *person* who
        may be linked to several children, not one guardian row per child.
        """
        with tenant_context(self.tenant.id):
            return GuardianFactory(tenant=self.tenant, user_id=user.pk)

    def _link_guardian(self, user, student, *, has_portal_access: bool = True, guardian=None):
        guardian = guardian or self._guardian_for(user)
        with tenant_context(self.tenant.id):
            StudentGuardianFactory(
                tenant=self.tenant,
                student=student,
                guardian=guardian,
                has_portal_access=has_portal_access,
            )
        return guardian

    def _own_scoped_client(self, user):
        authenticate(self.client, user)
        grant(user, VIEW_KEY, scope=RecordScope.OWN, is_restricted_principal=True)

    def test_a_guardian_sees_only_the_child_they_are_linked_to(self) -> None:
        guardian_user = UserFactory(tenant=self.tenant)
        self._link_guardian(guardian_user, self.own_child)
        self._own_scoped_client(guardian_user)

        response = self.client.get("/api/v1/students")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        ids = {row["id"] for row in response.json()["data"]}
        self.assertEqual(ids, {str(self.own_child.pk)})

    def test_a_guardian_gets_404_not_403_on_a_child_they_are_not_linked_to(self) -> None:
        guardian_user = UserFactory(tenant=self.tenant)
        self._link_guardian(guardian_user, self.own_child)
        self._own_scoped_client(guardian_user)

        response = self.client.get(f"/api/v1/students/{self.other_child.pk}")

        # 404, never 403 — a 403 confirms the row exists (AGENTS.md invariant 2).
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_guardian_whose_portal_access_was_revoked_sees_nothing(self) -> None:
        guardian_user = UserFactory(tenant=self.tenant)
        self._link_guardian(guardian_user, self.own_child, has_portal_access=False)
        self._own_scoped_client(guardian_user)

        response = self.client.get("/api/v1/students")

        self.assertEqual(response.json()["data"], [])

    def test_a_guardian_linked_to_two_children_sees_each_once(self) -> None:
        guardian_user = UserFactory(tenant=self.tenant)
        guardian = self._link_guardian(guardian_user, self.own_child)
        self._link_guardian(guardian_user, self.other_child, guardian=guardian)
        self._own_scoped_client(guardian_user)

        rows = self.client.get("/api/v1/students").json()["data"]

        # .distinct() on the hook: two guardian rows for one user must not
        # duplicate a child in the list.
        ids = [row["id"] for row in rows]
        self.assertCountEqual(ids, [str(self.own_child.pk), str(self.other_child.pk)])

    def test_a_student_still_sees_only_themself(self) -> None:
        """The path that already worked, kept honest by the same hook."""
        student_user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            self.own_child.user_id = student_user.pk
            self.own_child.save(update_fields=["user_id"])
        self._own_scoped_client(student_user)

        ids = {row["id"] for row in self.client.get("/api/v1/students").json()["data"]}

        self.assertEqual(ids, {str(self.own_child.pk)})

    def test_an_own_scoped_user_with_no_link_at_all_sees_nothing(self) -> None:
        stranger = UserFactory(tenant=self.tenant)
        self._own_scoped_client(stranger)

        self.assertEqual(self.client.get("/api/v1/students").json()["data"], [])


class MedicalNotesScopeTests(APITestCase):
    """`medical_notes` follows the scope of the key that reveals it (auth-and-rbac.md §2.3).

    `students.student.update` reveals the notes of the rows inside that key's own
    scope, and an `assigned` scope reveals them only when it is the scope of
    `students.student.view`. Read key-blind, holding the update key anywhere showed
    every readable row's notes, and an `assigned` role for any key showed a class
    teacher's students' notes.
    """

    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        enable_feature(self.tenant, "module.students")
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)
        with tenant_context(self.tenant.id):
            self.campus_a = CampusFactory(tenant=self.tenant)
            self.campus_b = CampusFactory(tenant=self.tenant)
            self.session = AcademicSessionFactory(tenant=self.tenant, is_current=True)
            self.school_class = ClassFactory(tenant=self.tenant, level=6)
            staff = StaffFactory(tenant=self.tenant, campus=self.campus_a, user_id=self.user.pk)
            # The caller is this section's class teacher, so `assigned` reaches its roll.
            self.section = SectionFactory(
                tenant=self.tenant,
                school_class=self.school_class,
                campus=self.campus_a,
                class_teacher_staff_id=staff.pk,
            )

    def _student(self, campus, *, taught: bool = False):
        with tenant_context(self.tenant.id):
            student = StudentFactory(tenant=self.tenant, campus=campus, medical_notes=NOTES)
            if taught:
                StudentEnrollmentFactory(
                    tenant=self.tenant,
                    student=student,
                    academic_session=self.session,
                    school_class=self.school_class,
                    section=self.section,
                )
        return student

    def _notes_shown(self, path: str = "/api/v1/students?page_size=100") -> dict[str, bool]:
        response = self.client.get(path)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        data = response.json()["data"]
        rows = data if isinstance(data, list) else [data]
        return {row["id"]: row.get("medical_notes") == NOTES for row in rows}

    def test_medical_notes_follow_the_update_roles_scope(self) -> None:
        in_scope = self._student(self.campus_a)
        out_of_scope = self._student(self.campus_b)
        grant(self.user, VIEW_KEY, UPDATE_KEY, scope=RecordScope.CAMPUS, scope_ref=self.campus_a.pk)
        # Reads campus B too, but grants no update anywhere.
        grant(self.user, VIEW_KEY, UNRELATED, scope=RecordScope.ALL)

        self.assertEqual(self._notes_shown(), {str(in_scope.pk): True, str(out_of_scope.pk): False})
        self.assertEqual(
            self._notes_shown(f"/api/v1/students/{out_of_scope.pk}"),
            {str(out_of_scope.pk): False},
        )

    def test_medical_notes_assigned_branch_reads_the_view_roles_scope(self) -> None:
        """The `assigned` scope here belongs to a marking role, not to the view key."""
        taught = self._student(self.campus_a, taught=True)
        grant(self.user, VIEW_KEY, scope=RecordScope.ALL)
        grant(self.user, "attendance.student-attendance.mark", scope=RecordScope.ASSIGNED)

        self.assertEqual(self._notes_shown(), {str(taught.pk): False})

    def test_an_assigned_class_teacher_sees_their_students_notes(self) -> None:
        taught = self._student(self.campus_a, taught=True)
        grant(self.user, VIEW_KEY, scope=RecordScope.ASSIGNED)
        grant(self.user, UNRELATED, scope=RecordScope.ALL)

        self.assertEqual(self._notes_shown(), {str(taught.pk): True})

    def test_medical_notes_query_count_is_constant(self) -> None:
        """Visibility is resolved once over the page, never with a query per row."""
        grant(self.user, VIEW_KEY, scope=RecordScope.ASSIGNED)
        grant(self.user, UNRELATED, scope=RecordScope.ALL)
        for _ in range(3):
            self._student(self.campus_a, taught=True)
        # Warm-up: the first request fills per-process caches (feature flags,
        # permissions), which would otherwise make the second measurement look cheaper.
        self._notes_shown()
        with CaptureQueriesContext(connection) as three_rows:
            shown = self._notes_shown()
        self.assertEqual(len(shown), 3)

        for _ in range(27):
            self._student(self.campus_a, taught=True)
        with CaptureQueriesContext(connection) as thirty_rows:
            shown = self._notes_shown()

        self.assertEqual(list(shown.values()), [True] * 30)
        self.assertEqual(len(thirty_rows), len(three_rows))
