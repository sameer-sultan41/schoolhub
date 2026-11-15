"""`/classes` endpoint tests (module doc §5.5, §16).

Ordering is the only dedicated endpoint coverage that existed for this
resource before this refactor — a pre-existing gap, not one introduced here.
"""

from __future__ import annotations

from django.utils import timezone
from rest_framework import status

from apps.school_organization.tests.base import SchoolOrganizationAPITestCase
from apps.school_organization.tests.factories import ClassFactory, TenantFactory
from core.tenancy.context import tenant_context


class ClassEndpointTests(SchoolOrganizationAPITestCase):
    # Each case creates its rows in an order that disagrees with the ordering it
    # asserts, so a passing test proves the sort ran rather than that insertion
    # order happened to match. `StableOrderingFilter` appends `pk`, so ties
    # resolve by a random UUID — no case here leaves two rows tied on the
    # column it sorts by. `_ids()` (GET a URL, assert 200, return the row ids
    # in order) is inherited from `SchoolOrganizationAPITestCase`.

    def test_sort_by_level_and_name(self) -> None:
        self.allow("school.class.view")
        with tenant_context(self.tenant.id):
            ten = ClassFactory(tenant=self.tenant, name="Grade 10", code="G10", level=10)
            two = ClassFactory(tenant=self.tenant, name="Grade 2", code="G2", level=2)

        # `level` is the promotion ladder and sorts numerically; `name` is a string,
        # so it puts "Grade 10" before "Grade 2". Both are offered because the table
        # renders both, and they are not the same order.
        self.assertEqual(self._ids("/api/v1/classes?ordering=level"), [str(two.pk), str(ten.pk)])
        self.assertEqual(self._ids("/api/v1/classes?ordering=-level"), [str(ten.pk), str(two.pk)])
        self.assertEqual(self._ids("/api/v1/classes?ordering=name"), [str(ten.pk), str(two.pk)])
        self.assertEqual(self._ids("/api/v1/classes?ordering=-code"), [str(two.pk), str(ten.pk)])

    def test_ignore_an_undeclared_ordering_field(self) -> None:
        self.allow("school.class.view")
        with tenant_context(self.tenant.id):
            ten = ClassFactory(tenant=self.tenant, name="Grade 10", level=10, is_active=False)
            two = ClassFactory(tenant=self.tenant, name="Grade 2", level=2)

        # `is_active` filters this endpoint but does not sort it; honoured, false
        # first would lead with Grade 10 instead of the default `level` order.
        self.assertEqual(
            self._ids("/api/v1/classes?ordering=is_active"), [str(two.pk), str(ten.pk)]
        )


class ClassLevelUniquenessTests(SchoolOrganizationAPITestCase):
    """`level` is the promotion ladder, unique among a school's live classes (module doc §11).

    A clash is the `level` field's own error, so a form can show it under the input; the
    partial unique constraint stays behind it for a race between two writers.
    """

    TAKEN = "Level 1 is already used by class 'Grade 1'."

    def setUp(self) -> None:
        super().setUp()
        self.allow("school.class.view", "school.class.create", "school.class.update")
        with tenant_context(self.tenant.id):
            self.grade1 = ClassFactory(tenant=self.tenant, name="Grade 1", level=1)

    def _level_error(self, response) -> list[dict[str, str]]:
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, response.json())
        error = response.json()["error"]
        self.assertEqual(error["code"], "validation_error")
        return error["details"]

    def test_a_taken_level_is_the_level_fields_error(self) -> None:
        response = self.client.post(
            "/api/v1/classes", {"name": "Grade One", "level": 1}, format="json"
        )

        self.assertEqual(self._level_error(response), [{"field": "level", "issue": self.TAKEN}])

    def test_moving_onto_a_taken_level_is_refused_and_keeping_its_own_is_not(self) -> None:
        with tenant_context(self.tenant.id):
            grade2 = ClassFactory(tenant=self.tenant, name="Grade 2", level=2)

        moved = self.client.patch(f"/api/v1/classes/{grade2.pk}", {"level": 1}, format="json")
        renamed = self.client.patch(
            f"/api/v1/classes/{self.grade1.pk}", {"name": "Class 1", "level": 1}, format="json"
        )

        self.assertEqual(self._level_error(moved), [{"field": "level", "issue": self.TAKEN}])
        self.assertEqual(renamed.status_code, status.HTTP_200_OK, renamed.json())

    def test_a_deleted_class_frees_its_level(self) -> None:
        with tenant_context(self.tenant.id):
            self.grade1.deleted_at = timezone.now()
            self.grade1.save(update_fields=["deleted_at"])

        response = self.client.post(
            "/api/v1/classes", {"name": "Grade One", "level": 1}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())

    def test_another_schools_level_does_not_count(self) -> None:
        other = TenantFactory()
        with tenant_context(other.id):
            ClassFactory(tenant=other, name="Grade 5", level=5)

        response = self.client.post(
            "/api/v1/classes", {"name": "Grade 5", "level": 5}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
