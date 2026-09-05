"""What a campus-scoped principal actually sees.

Every other test in this suite authenticates an `all`-scoped user, and
`scope_queryset` returns before the campus branch on that scope — so the campus
path was, in practice, never executed anywhere. That is how seven viewsets came
to answer **500** for a real role: the mixin defaults `scope_campus_field` to
`"campus_id"`, and filtering on a column that does not exist raises `FieldError`.

Two different right answers are pinned here, because "no campus column" does not
mean one thing:

- **Tenant-wide tables** — classes, subjects, houses, sessions, terms,
  designations. There is no campus dimension and none can be invented, so a
  campus scope is already satisfied by tenant scoping and the rows pass through.
  Returning nothing would be the quieter bug: a campus admin who cannot see
  "Grade 6" cannot create a section in it.
- **`/campuses` itself** — the row *is* the campus, so the dimension is its own
  primary key and the principal sees the campuses they hold, not all of them.
- **Nullable campus columns** — departments and curriculum mappings *do* have a
  campus, and it is nullable to mean "every campus". `IN (...)` drops NULL, so
  narrowing on it alone loses exactly the shared rows that apply to the
  principal, and nothing errors: the list is simply short. `scope_campus_allows_null`
  widens the match, and the tests below assert the row is visible rather than
  merely that the query does not crash.
"""

from __future__ import annotations

from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    ClassSubjectFactory,
    DepartmentFactory,
    HouseFactory,
    SubjectFactory,
    TenantFactory,
    TermFactory,
    UserFactory,
    authenticate,
    grant,
)
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context


class CampusScopedPrincipalTests(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.other_campus = CampusFactory(tenant=self.tenant)
            self.grade = ClassFactory(tenant=self.tenant, level=6)
            self.subject = SubjectFactory(tenant=self.tenant)
            self.house = HouseFactory(tenant=self.tenant)

        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)

    def scoped(self, *keys: str) -> None:
        grant(self.user, *keys, scope=RecordScope.CAMPUS, scope_ref=self.campus.pk)

    def test_tenant_wide_lists_do_not_500_and_are_not_empty(self) -> None:
        """The regression itself, across every viewset that claimed the fix.

        Each of these raised FieldError before. Asserting the row is *there*
        rather than just that the response is 200 is the point: returning
        `.none()` would also have been a 200, and a campus admin who cannot see
        "Grade 6" cannot create a section in it.
        """
        with tenant_context(self.tenant.id):
            session = AcademicSessionFactory(tenant=self.tenant)
            TermFactory(tenant=self.tenant, academic_session=session)

        for path, key in (
            ("/api/v1/classes", "school.class.view"),
            ("/api/v1/subjects", "school.subject.view"),
            ("/api/v1/houses", "school.house.view"),
            ("/api/v1/academic-sessions", "school.academic-session.view"),
            # Terms have no key of their own — §4 folds them into the session
            # key, whose description says "academic sessions and terms".
            ("/api/v1/terms", "school.academic-session.view"),
        ):
            with self.subTest(path=path):
                user = UserFactory(tenant=self.tenant)
                authenticate(self.client, user)
                grant(user, key, scope=RecordScope.CAMPUS, scope_ref=self.campus.pk)

                response = self.client.get(path)

                self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
                self.assertGreaterEqual(
                    len(response.json()["data"]),
                    1,
                    "a tenant-wide row must stay visible to a campus-scoped principal",
                )

    def test_campuses_narrows_to_the_ones_the_principal_holds(self) -> None:
        """`/campuses` is the one list where a campus scope really does narrow."""
        self.scoped("school.campus.view")

        response = self.client.get("/api/v1/campuses")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertEqual(
            [row["id"] for row in response.json()["data"]],
            [str(self.campus.pk)],
            "the other campus must not be listed",
        )

    def test_another_campus_is_a_404_not_a_403(self) -> None:
        """The cross-scope invariant, same as the cross-tenant one: never reveal
        that the row exists."""
        self.scoped("school.campus.view")

        response = self.client.get(f"/api/v1/campuses/{self.other_campus.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_the_principals_own_campus_still_resolves(self) -> None:
        """The positive control — without it the test above passes on a scope that
        hides everything."""
        self.scoped("school.campus.view")

        response = self.client.get(f"/api/v1/campuses/{self.campus.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)


class NullableCampusTests(APITestCase):
    """Columns where NULL means "every campus" — the quieter half of the bug.

    `departments.campus_id` and `class_subjects.campus_id` are nullable and say
    so in their own `help_text`. Narrowing to `campus_id IN (...)` drops those
    rows, and nothing errors — the shared department and the shared curriculum
    mapping are simply absent from a campus-scoped principal's list. That is
    worse than the 500, because a crash gets reported and a short list does not.
    """

    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.other_campus = CampusFactory(tenant=self.tenant)
            self.session = AcademicSessionFactory(tenant=self.tenant)
            self.grade = ClassFactory(tenant=self.tenant, level=6)
            self.subject = SubjectFactory(tenant=self.tenant)

            # One shared row, one on this campus, one on the other.
            self.shared_department = DepartmentFactory(tenant=self.tenant, campus=None)
            self.mine_department = DepartmentFactory(tenant=self.tenant, campus=self.campus)
            self.foreign_department = DepartmentFactory(
                tenant=self.tenant, campus=self.other_campus
            )

            self.shared_mapping = ClassSubjectFactory(
                tenant=self.tenant,
                academic_session=self.session,
                school_class=self.grade,
                subject=self.subject,
                campus=None,
            )

        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)

    def test_a_tenant_wide_department_stays_visible_to_a_campus_principal(self) -> None:
        grant(
            self.user,
            "school.department.view",
            scope=RecordScope.CAMPUS,
            scope_ref=self.campus.pk,
        )

        ids = {row["id"] for row in self.client.get("/api/v1/departments").json()["data"]}

        self.assertIn(str(self.shared_department.pk), ids, "the shared department vanished")
        self.assertIn(str(self.mine_department.pk), ids)

    def test_another_campuses_department_is_still_excluded(self) -> None:
        """The positive control's other half — widening for NULL must not widen
        for everything."""
        grant(
            self.user,
            "school.department.view",
            scope=RecordScope.CAMPUS,
            scope_ref=self.campus.pk,
        )

        ids = {row["id"] for row in self.client.get("/api/v1/departments").json()["data"]}

        self.assertNotIn(str(self.foreign_department.pk), ids)

    def test_a_tenant_wide_curriculum_mapping_stays_visible(self) -> None:
        grant(
            self.user,
            "school.subject.view",
            scope=RecordScope.CAMPUS,
            scope_ref=self.campus.pk,
        )

        ids = {row["id"] for row in self.client.get("/api/v1/class-subjects").json()["data"]}

        self.assertIn(str(self.shared_mapping.pk), ids, "the shared curriculum row vanished")
