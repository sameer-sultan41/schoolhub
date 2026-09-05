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
"""

from __future__ import annotations

from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import (
    CampusFactory,
    ClassFactory,
    HouseFactory,
    SubjectFactory,
    TenantFactory,
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
        """The regression itself. Each of these used to raise FieldError."""
        for path, key in (
            ("/api/v1/classes", "school.class.view"),
            ("/api/v1/subjects", "school.subject.view"),
            ("/api/v1/houses", "school.house.view"),
        ):
            with self.subTest(path=path):
                user = UserFactory(tenant=self.tenant)
                authenticate(self.client, user)
                grant(user, key, scope=RecordScope.CAMPUS, scope_ref=self.campus.pk)

                response = self.client.get(path)

                self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
                self.assertEqual(
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
