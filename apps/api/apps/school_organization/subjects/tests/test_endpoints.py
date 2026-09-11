"""`/subjects` endpoint tests (module doc §5.6, §16).

Ordering is the only dedicated endpoint coverage that existed for this
resource before this refactor — a pre-existing gap, not one introduced here.
"""

from __future__ import annotations

from apps.school_organization.models import SubjectType
from apps.school_organization.tests.base import SchoolOrganizationAPITestCase
from apps.school_organization.tests.factories import DepartmentFactory, SubjectFactory
from core.tenancy.context import tenant_context


class SubjectEndpointTests(SchoolOrganizationAPITestCase):
    # Each case creates its rows in an order that disagrees with the ordering it
    # asserts, so a passing test proves the sort ran rather than that insertion
    # order happened to match. `StableOrderingFilter` appends `pk`, so ties
    # resolve by a random UUID — no case here leaves two rows tied on the
    # column it sorts by. `_ids()` (GET a URL, assert 200, return the row ids
    # in order) is inherited from `SchoolOrganizationAPITestCase`.

    def test_sort_by_the_annotated_department_name(self) -> None:
        self.allow("school.subject.view")
        with tenant_context(self.tenant.id):
            science = DepartmentFactory(tenant=self.tenant, name="Science", code="SCI")
            arts = DepartmentFactory(tenant=self.tenant, name="Arts", code="ART")
            algebra = SubjectFactory(
                tenant=self.tenant, name="Algebra", code="ALG", department=science
            )
            drawing = SubjectFactory(
                tenant=self.tenant, name="Drawing", code="DRW", department=arts
            )

        # Arts before Science, the opposite of the subjects' own name order.
        self.assertEqual(
            self._ids("/api/v1/subjects?ordering=department_name"),
            [str(drawing.pk), str(algebra.pk)],
        )
        self.assertEqual(
            self._ids("/api/v1/subjects?ordering=-department_name"),
            [str(algebra.pk), str(drawing.pk)],
        )

    def test_ignore_an_undeclared_ordering_field(self) -> None:
        self.allow("school.subject.view")
        with tenant_context(self.tenant.id):
            algebra = SubjectFactory(
                tenant=self.tenant,
                name="Algebra",
                code="ALG",
                subject_type=SubjectType.ELECTIVE,
            )
            drawing = SubjectFactory(
                tenant=self.tenant, name="Drawing", code="DRW", subject_type=SubjectType.CORE
            )

        # `subject_type` filters but does not sort; honoured, "core" < "elective"
        # would lead with Drawing.
        self.assertEqual(
            self._ids("/api/v1/subjects?ordering=subject_type"),
            [str(algebra.pk), str(drawing.pk)],
        )
