"""`/departments` endpoint tests (module doc §5.3, §16).

Ordering is the only dedicated endpoint coverage that existed for this
resource before this refactor — a pre-existing gap, not one introduced here.
Cross-campus scoping behaviour (the nullable `campus_id` column) is covered by
`tests/test_campus_scope.py::NullableCampusTests` at the app root, alongside
the other endpoints that scoping mechanism spans.
"""

from __future__ import annotations

from apps.school_organization.tests.base import SchoolOrganizationAPITestCase
from apps.school_organization.tests.factories import CampusFactory, DepartmentFactory
from core.tenancy.context import tenant_context


class DepartmentEndpointTests(SchoolOrganizationAPITestCase):
    # Each case creates its rows in an order that disagrees with the ordering it
    # asserts, so a passing test proves the sort ran rather than that insertion
    # order happened to match. `StableOrderingFilter` appends `pk`, so ties
    # resolve by a random UUID — no case here leaves two rows tied on the
    # column it sorts by. `_ids()` (GET a URL, assert 200, return the row ids
    # in order) is inherited from `SchoolOrganizationAPITestCase`.

    def test_sort_by_the_annotated_campus_name(self) -> None:
        self.allow("school.department.view")
        with tenant_context(self.tenant.id):
            north = CampusFactory(tenant=self.tenant, name="North", code="NORTH")
            east = CampusFactory(tenant=self.tenant, name="East", code="EAST")
            arts = DepartmentFactory(tenant=self.tenant, name="Arts", code="ART", campus=north)
            science = DepartmentFactory(tenant=self.tenant, name="Science", code="SCI", campus=east)
            shared = DepartmentFactory(tenant=self.tenant, name="Admin", code="ADM")

        # `campus_name` is the annotation, not `campus__name`. Campus order (East,
        # North) is the opposite of the departments' own name order, and `shared`
        # spans every campus — a NULL, which Postgres sorts last ascending and
        # first descending.
        self.assertEqual(
            self._ids("/api/v1/departments?ordering=campus_name"),
            [str(science.pk), str(arts.pk), str(shared.pk)],
        )
        self.assertEqual(
            self._ids("/api/v1/departments?ordering=-campus_name"),
            [str(shared.pk), str(arts.pk), str(science.pk)],
        )

    def test_ignore_an_undeclared_or_traversing_ordering_field(self) -> None:
        self.allow("school.department.view")
        with tenant_context(self.tenant.id):
            north = CampusFactory(tenant=self.tenant, name="North", code="NORTH")
            east = CampusFactory(tenant=self.tenant, name="East", code="EAST")
            arts = DepartmentFactory(
                tenant=self.tenant, name="Arts", code="ART", campus=north, description="Zulu"
            )
            science = DepartmentFactory(
                tenant=self.tenant, name="Science", code="SCI", campus=east, description="Alpha"
            )

        by_name = [str(arts.pk), str(science.pk)]

        # Both would lead with Science if they sorted: `description` is a real
        # column outside the allowlist, and `campus__name` is the relation
        # traversal `ordering_fields` must never contain. Dropping the traversal is
        # what keeps a scoped principal's `SELECT DISTINCT` from raising
        # ProgrammingError.
        self.assertEqual(self._ids("/api/v1/departments?ordering=description"), by_name)
        self.assertEqual(self._ids("/api/v1/departments?ordering=campus__name"), by_name)
