"""`class_subjects.campus_id` is nullable, and NULL means "every campus".

The pair to `school_organization/tests/test_campus_scope.py::NullableCampusTests`.
Both tables have the same shape — a real campus column that is nullable, where
NULL is the shared row every campus uses — and `campus_id IN (...)` drops NULL,
so narrowing on it alone loses exactly the rows that apply to the principal.
Nothing errors; the list is simply short, which is worse than a crash because a
crash gets reported.

These live here rather than beside their department counterpart because
`/class-subjects` moved to academics in this PR: the route is unchanged, but it
now needs `academics.curriculum.view` and `module.academics`, neither of which a
school_organization test grants. Testing an endpoint from the module that no
longer guards it is what broke the suite when the endpoint first moved.
"""

from __future__ import annotations

from rest_framework import status

from apps.academics.tests.base import AcademicsAPITestCase
from apps.school_organization.tests.factories import (
    CampusFactory,
    ClassSubjectFactory,
    SubjectFactory,
    UserFactory,
    authenticate,
    grant,
)
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context


class NullableCampusCurriculumTests(AcademicsAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.other_campus = CampusFactory(tenant=self.tenant)
            shared_subject = SubjectFactory(tenant=self.tenant)
            foreign_subject = SubjectFactory(tenant=self.tenant)

            # `campus=None` — the mapping every campus teaches.
            self.shared_mapping = ClassSubjectFactory(
                tenant=self.tenant,
                academic_session=self.session,
                school_class=self.school_class,
                subject=shared_subject,
                campus=None,
            )
            self.foreign_mapping = ClassSubjectFactory(
                tenant=self.tenant,
                academic_session=self.session,
                school_class=self.school_class,
                subject=foreign_subject,
                campus=self.other_campus,
            )

        # A second user, scoped to one campus. The base fixture's user is
        # `all`-scoped, and `scope_queryset` returns before the campus branch for
        # those — which is how this path went unexercised everywhere.
        self.scoped_user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.scoped_user)
        grant(
            self.scoped_user,
            "academics.curriculum.view",
            scope=RecordScope.CAMPUS,
            scope_ref=self.campus.pk,
        )

    def listed_ids(self) -> set[str]:
        response = self.client.get("/api/v1/class-subjects")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        return {row["id"] for row in response.json()["data"]}

    def test_a_tenant_wide_mapping_stays_visible_to_a_campus_principal(self) -> None:
        self.assertIn(
            str(self.shared_mapping.pk),
            self.listed_ids(),
            "the shared curriculum row vanished",
        )

    def test_another_campuses_mapping_is_still_excluded(self) -> None:
        """Without this, "the shared row is visible" is equally satisfied by a
        widening that returns everything — which is the failure a scope test
        exists to catch."""
        self.assertNotIn(str(self.foreign_mapping.pk), self.listed_ids())
