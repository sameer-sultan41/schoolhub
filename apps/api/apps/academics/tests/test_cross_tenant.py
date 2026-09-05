"""Cross-tenant access on every academics endpoint class.

testing-strategy.md §3: for each endpoint, a tenant-A caller attempting a
tenant-B resource must get **404, never 403** — a 403 confirms the row exists.
The acting user is granted every key in the module, so a denial here can only
come from tenant scoping and never from a missing permission.
"""

from __future__ import annotations

import uuid

from rest_framework import status

from apps.academics.tests.base import AcademicsAPITestCase
from apps.academics.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    ClassSubjectFactory,
    SectionFactory,
    StaffFactory,
    SubjectFactory,
    TeacherAllocationFactory,
    TenantFactory,
    enable_feature,
)
from core.rbac.registry import registry
from core.tenancy.context import tenant_context


class AcademicsCrossTenantTests(AcademicsAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow(*(spec.key for spec in registry.for_module("academics")))

        self.other = TenantFactory()
        enable_feature(self.other, "module.academics")
        with tenant_context(self.other.id):
            other_campus = CampusFactory(tenant=self.other)
            self.other_session = AcademicSessionFactory(tenant=self.other)
            other_class = ClassFactory(tenant=self.other, level=6)
            self.other_section = SectionFactory(
                tenant=self.other, school_class=other_class, campus=other_campus
            )
            self.other_subject = SubjectFactory(tenant=self.other)
            self.other_curriculum = ClassSubjectFactory(
                tenant=self.other,
                academic_session=self.other_session,
                school_class=other_class,
                subject=self.other_subject,
            )
            self.other_staff = StaffFactory(tenant=self.other, campus=other_campus)
            self.other_allocation = TeacherAllocationFactory(
                tenant=self.other,
                academic_session=self.other_session,
                section=self.other_section,
                subject=self.other_subject,
                staff=self.other_staff,
            )

    # ---- detail reads -----------------------------------------------------

    def test_reading_another_tenants_curriculum_row_is_404(self) -> None:
        response = self.client.get(f"/api/v1/class-subjects/{self.other_curriculum.pk}")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_reading_another_tenants_allocation_is_404(self) -> None:
        response = self.client.get(
            f"/api/v1/teacher-subject-allocations/{self.other_allocation.pk}"
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    # ---- list leakage -----------------------------------------------------

    def test_lists_never_contain_another_tenants_rows(self) -> None:
        curriculum_ids = {
            row["id"] for row in self.client.get("/api/v1/class-subjects").json()["data"]
        }
        allocation_ids = {
            row["id"]
            for row in self.client.get("/api/v1/teacher-subject-allocations").json()["data"]
        }
        promotion_ids = {
            row["id"] for row in self.client.get("/api/v1/student-promotions").json()["data"]
        }

        self.assertNotIn(str(self.other_curriculum.pk), curriculum_ids)
        self.assertNotIn(str(self.other_allocation.pk), allocation_ids)
        self.assertEqual(promotion_ids, set())

    def test_filtering_by_another_tenants_id_returns_nothing(self) -> None:
        """A filter is not a back door: the scoped queryset applies first."""
        response = self.client.get(
            f"/api/v1/class-subjects?academic_session_id={self.other_session.pk}"
        )

        self.assertEqual(response.json()["data"], [])

    # ---- writes with a smuggled foreign id --------------------------------

    def test_creating_a_curriculum_row_against_a_foreign_session_is_rejected(self) -> None:
        response = self.client.post(
            "/api/v1/class-subjects",
            {
                "academic_session_id": str(self.other_session.pk),
                "class_id": str(self.school_class.pk),
                "subject_id": str(self.subject.pk),
            },
            format="json",
        )

        # 400: the tenant-scoped queryset behind the PrimaryKeyRelatedField
        # cannot resolve the id at all, so it never becomes a permission
        # question in the first place.
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_allocating_a_foreign_teacher_is_rejected(self) -> None:
        response = self.client.post(
            "/api/v1/teacher-subject-allocations",
            {
                "academic_session_id": str(self.session.pk),
                "section_id": str(self.section.pk),
                "subject_id": str(self.subject.pk),
                "staff_id": str(self.other_staff.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_patching_another_tenants_curriculum_row_is_404(self) -> None:
        response = self.client.patch(
            f"/api/v1/class-subjects/{self.other_curriculum.pk}",
            {"weekly_periods": 9},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_deleting_another_tenants_allocation_is_404(self) -> None:
        response = self.client.delete(
            f"/api/v1/teacher-subject-allocations/{self.other_allocation.pk}"
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    # ---- colon actions ----------------------------------------------------

    def test_cloning_from_another_tenants_session_is_rejected(self) -> None:
        response = self.client.post(
            "/api/v1/class-subjects:clone",
            {
                "source_academic_session_id": str(self.other_session.pk),
                "target_academic_session_id": str(self.next_session.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_acting_on_an_unknown_promotion_batch_is_404(self) -> None:
        """A batch id names a resource, so an unknown one is 404 like any other.

        This also covers the foreign case: `batch_queryset` is tenant-scoped, so
        another tenant's batch id reaches the same branch and is indistinguishable
        from one that never existed (AGENTS.md invariant 2).
        """
        stray = uuid.uuid4()

        for action in ("submit", "approve", "reject", "execute", "revert"):
            with self.subTest(action=action):
                response = self.client.post(
                    f"/api/v1/student-promotions/{stray}:{action}", {}, format="json"
                )
                self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    # ---- positive control -------------------------------------------------

    def test_the_same_routes_succeed_for_the_callers_own_records(self) -> None:
        """Without this, every assertion above could pass for the wrong reason."""
        self.assertEqual(
            self.client.get(f"/api/v1/class-subjects/{self.curriculum.pk}").status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            self.client.get("/api/v1/teacher-subject-allocations").status_code,
            status.HTTP_200_OK,
        )
