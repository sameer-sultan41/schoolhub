"""`/classes` endpoint tests (module doc §5.5, §16).

Ordering is the only dedicated endpoint coverage that existed for this
resource before this refactor — a pre-existing gap, not one introduced here.
"""

from __future__ import annotations

from apps.school_organization.tests.base import SchoolOrganizationAPITestCase
from apps.school_organization.tests.factories import ClassFactory
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
