"""Record scope `own` on students — both principals it has to cover.

`scope_queryset` used to filter `RecordScope.OWN` as `students.user_id == user.pk`
and nothing else, so a guardian's portal account matched no student at all: "a
guardian can see only their own child's record" was not enforced, it simply
returned nothing while looking like it worked. `Student.filter_owned_by_user` is
the hook that fixes it; these are the assertions that keep it fixed.
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
    GuardianFactory,
    StudentFactory,
    StudentGuardianFactory,
    enable_feature,
)
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

VIEW_KEY = "students.student.view"


class StudentOwnScopeTests(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        enable_feature(self.tenant, "module.students")
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.own_child = StudentFactory(tenant=self.tenant, campus=self.campus)
            self.other_child = StudentFactory(tenant=self.tenant, campus=self.campus)

    def _link_guardian(self, user, student, *, has_portal_access: bool = True) -> None:
        with tenant_context(self.tenant.id):
            guardian = GuardianFactory(tenant=self.tenant, user_id=user.pk)
            StudentGuardianFactory(
                tenant=self.tenant,
                student=student,
                guardian=guardian,
                has_portal_access=has_portal_access,
            )

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
        self._link_guardian(guardian_user, self.own_child)
        self._link_guardian(guardian_user, self.other_child)
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
