"""`/sections` endpoint tests (module doc §5.5, §16)."""

from __future__ import annotations

from rest_framework import status

from apps.school_organization.models import Section
from apps.school_organization.tests.base import SchoolOrganizationAPITestCase
from apps.school_organization.tests.factories import CampusFactory, ClassFactory, SectionFactory
from core.tenancy.context import tenant_context


class SectionEndpointTests(SchoolOrganizationAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.grade = ClassFactory(tenant=self.tenant)

    def test_create_uses_the_documented_class_id_field(self) -> None:
        self.allow("school.section.view", "school.section.create")
        response = self.client.post(
            "/api/v1/sections",
            {
                "class_id": str(self.grade.pk),
                "campus_id": str(self.campus.pk),
                "name": "A",
                "capacity": 30,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        body = response.json()["data"]
        self.assertEqual(body["class_id"], str(self.grade.pk))

        with tenant_context(self.tenant.id):
            self.assertTrue(Section.objects.filter(school_class=self.grade).exists())

    def test_create_rejects_a_zero_capacity(self) -> None:
        self.allow("school.section.view", "school.section.create")
        response = self.client.post(
            "/api/v1/sections",
            {
                "class_id": str(self.grade.pk),
                "campus_id": str(self.campus.pk),
                "name": "A",
                "capacity": 0,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_rejects_an_inactive_class(self) -> None:
        self.allow("school.section.view", "school.section.create")
        with tenant_context(self.tenant.id):
            self.grade.is_active = False
            self.grade.save(update_fields=["is_active"])

        response = self.client.post(
            "/api/v1/sections",
            {"class_id": str(self.grade.pk), "campus_id": str(self.campus.pk), "name": "A"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_list_filters_by_campus(self) -> None:
        self.allow("school.section.view")
        with tenant_context(self.tenant.id):
            other_campus = CampusFactory(tenant=self.tenant)
            SectionFactory(tenant=self.tenant, campus=self.campus, school_class=self.grade)
            SectionFactory(tenant=self.tenant, campus=other_campus, school_class=self.grade)

        response = self.client.get(f"/api/v1/sections?campus_id={self.campus.pk}")

        self.assertEqual(len(response.json()["data"]), 1)

    # ------------------------------------------------------------------ ordering
    #
    # Each case creates its rows in an order that disagrees with the ordering it
    # asserts, so a passing test proves the sort ran rather than that insertion
    # order happened to match.

    def _ids(self, url: str) -> list[str]:
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return [row["id"] for row in response.json()["data"]]

    def test_sort_by_the_annotated_class_and_campus_names(self) -> None:
        self.allow("school.section.view")
        with tenant_context(self.tenant.id):
            north = CampusFactory(tenant=self.tenant, name="North", code="NORTH")
            east = CampusFactory(tenant=self.tenant, name="East", code="EAST")
            ten = ClassFactory(tenant=self.tenant, name="Grade 10", level=10)
            two = ClassFactory(tenant=self.tenant, name="Grade 2", level=2)
            north_ten = SectionFactory(tenant=self.tenant, campus=north, school_class=ten, name="A")
            east_two = SectionFactory(tenant=self.tenant, campus=east, school_class=two, name="B")

        # The two annotations resolve opposite orders — "Grade 10" < "Grade 2" but
        # "East" < "North" — so an alias wired to the wrong join fails here.
        self.assertEqual(
            self._ids("/api/v1/sections?ordering=class_name"),
            [str(north_ten.pk), str(east_two.pk)],
        )
        self.assertEqual(
            self._ids("/api/v1/sections?ordering=-class_name"),
            [str(east_two.pk), str(north_ten.pk)],
        )
        self.assertEqual(
            self._ids("/api/v1/sections?ordering=campus_name"),
            [str(east_two.pk), str(north_ten.pk)],
        )

    def test_sort_by_capacity_with_unlimited_last(self) -> None:
        self.allow("school.section.view")
        with tenant_context(self.tenant.id):
            campus = CampusFactory(tenant=self.tenant, name="North", code="NORTH")
            grade = ClassFactory(tenant=self.tenant, name="Grade 1", level=1)
            small = SectionFactory(
                tenant=self.tenant, campus=campus, school_class=grade, name="A", capacity=20
            )
            large = SectionFactory(
                tenant=self.tenant, campus=campus, school_class=grade, name="B", capacity=40
            )
            unlimited = SectionFactory(
                tenant=self.tenant, campus=campus, school_class=grade, name="C", capacity=None
            )

        # `capacity` is nullable and NULL means unlimited, so the unbounded section
        # bookends the list: last ascending, first descending.
        self.assertEqual(
            self._ids("/api/v1/sections?ordering=capacity"),
            [str(small.pk), str(large.pk), str(unlimited.pk)],
        )
        self.assertEqual(
            self._ids("/api/v1/sections?ordering=-capacity"),
            [str(unlimited.pk), str(large.pk), str(small.pk)],
        )

    def test_ignore_an_undeclared_ordering_field(self) -> None:
        self.allow("school.section.view")
        with tenant_context(self.tenant.id):
            campus = CampusFactory(tenant=self.tenant, name="North", code="NORTH")
            grade = ClassFactory(tenant=self.tenant, name="Grade 1", level=1)
            first = SectionFactory(tenant=self.tenant, campus=campus, school_class=grade, name="A")
            second = SectionFactory(
                tenant=self.tenant,
                campus=campus,
                school_class=grade,
                name="B",
                is_active=False,
            )

        # One class, so the view default reduces to `name`. `is_active` would lead
        # with B if it sorted.
        self.assertEqual(
            self._ids("/api/v1/sections?ordering=is_active"), [str(first.pk), str(second.pk)]
        )
