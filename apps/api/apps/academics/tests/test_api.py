"""API-level tests for curriculum and teacher allocation."""

from __future__ import annotations

from rest_framework import status

from apps.academics.models import TeacherSubjectAllocation
from apps.academics.tests.base import AcademicsAPITestCase
from apps.academics.tests.factories import (
    ClassSubjectFactory,
    StaffFactory,
    SubjectFactory,
    TeacherAllocationFactory,
)
from apps.school_organization.models import ClassSubject, SessionStatus
from apps.staff_management.models import EmploymentStatus, StaffType
from core.tenancy.context import tenant_context


class CurriculumEndpointTests(AcademicsAPITestCase):
    """`/class-subjects` moved from school_organization to academics.

    The route is unchanged; the keys and the feature flag are not, which is the
    point of these tests — a caller holding only the old `school.subject.*` keys
    must now be refused.
    """

    def test_listing_requires_the_academics_key_not_the_school_one(self) -> None:
        self.allow("school.subject.view")

        self.assertEqual(
            self.client.get("/api/v1/class-subjects").status_code,
            status.HTTP_403_FORBIDDEN,
        )

        self.allow("academics.curriculum.view")
        self.assertEqual(self.client.get("/api/v1/class-subjects").status_code, status.HTTP_200_OK)

    def test_create_goes_through_the_school_organization_service(self) -> None:
        self.allow("academics.curriculum.create", "academics.curriculum.view")
        with tenant_context(self.tenant.id):
            other_subject = SubjectFactory(tenant=self.tenant)

        response = self.client.post(
            "/api/v1/class-subjects",
            {
                "academic_session_id": str(self.session.pk),
                "class_id": str(self.school_class.pk),
                "subject_id": str(other_subject.pk),
                "weekly_periods": 4,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        with tenant_context(self.tenant.id):
            self.assertTrue(
                ClassSubject.objects.alive()
                .filter(academic_session=self.session, subject=other_subject)
                .exists()
            )

    def test_a_duplicate_mapping_is_a_conflict(self) -> None:
        """`map_subject_to_class` owns this rule; the API must surface it as 409."""
        self.allow("academics.curriculum.create")

        response = self.client.post(
            "/api/v1/class-subjects",
            {
                "academic_session_id": str(self.session.pk),
                "class_id": str(self.school_class.pk),
                "subject_id": str(self.subject.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_weekly_periods_below_one_is_rejected(self) -> None:
        self.allow("academics.curriculum.create")
        with tenant_context(self.tenant.id):
            other_subject = SubjectFactory(tenant=self.tenant)

        response = self.client.post(
            "/api/v1/class-subjects",
            {
                "academic_session_id": str(self.session.pk),
                "class_id": str(self.school_class.pk),
                "subject_id": str(other_subject.pk),
                "weekly_periods": 0,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_a_closed_session_is_read_only(self) -> None:
        """§11's session lock."""
        self.allow("academics.curriculum.create")
        with tenant_context(self.tenant.id):
            self.session.status = SessionStatus.CLOSED
            self.session.save(update_fields=["status"])
            other_subject = SubjectFactory(tenant=self.tenant)

        response = self.client.post(
            "/api/v1/class-subjects",
            {
                "academic_session_id": str(self.session.pk),
                "class_id": str(self.school_class.pk),
                "subject_id": str(other_subject.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_term_plans_must_reference_this_sessions_terms(self) -> None:
        self.allow("academics.curriculum.update")
        with tenant_context(self.tenant.id):
            stray_term = self.next_session.terms.create(
                tenant=self.tenant,
                name="Stray",
                sequence=1,
                start_date=self.next_session.start_date,
                end_date=self.next_session.end_date,
            )

        response = self.client.patch(
            f"/api/v1/class-subjects/{self.curriculum.pk}",
            {"term_plans": [{"term_id": str(stray_term.pk), "topics": ["x"]}]},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)


class CloneCurriculumTests(AcademicsAPITestCase):
    def test_clones_rows_into_the_target_session(self) -> None:
        self.allow("academics.curriculum.create")

        response = self.client.post(
            "/api/v1/class-subjects:clone",
            {
                "source_academic_session_id": str(self.session.pk),
                "target_academic_session_id": str(self.next_session.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["created"], 1)
        with tenant_context(self.tenant.id):
            self.assertTrue(
                ClassSubject.objects.alive()
                .filter(academic_session=self.next_session, subject=self.subject)
                .exists()
            )

    def test_re_cloning_skips_rows_that_already_exist(self) -> None:
        """Converges rather than refusing — what makes the action safe to retry."""
        self.allow("academics.curriculum.create")
        payload = {
            "source_academic_session_id": str(self.session.pk),
            "target_academic_session_id": str(self.next_session.pk),
        }
        self.client.post("/api/v1/class-subjects:clone", payload, format="json")

        second = self.client.post("/api/v1/class-subjects:clone", payload, format="json")

        self.assertEqual(second.json()["data"], {"created": 0, "skipped": 1})

    def test_cloning_a_session_onto_itself_is_rejected(self) -> None:
        self.allow("academics.curriculum.create")

        response = self.client.post(
            "/api/v1/class-subjects:clone",
            {
                "source_academic_session_id": str(self.session.pk),
                "target_academic_session_id": str(self.session.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)


class TeacherAllocationEndpointTests(AcademicsAPITestCase):
    def _payload(self, **overrides) -> dict:
        base = {
            "academic_session_id": str(self.session.pk),
            "section_id": str(self.section.pk),
            "subject_id": str(self.subject.pk),
            "staff_id": str(self.teacher.pk),
        }
        base.update(overrides)
        return base

    def test_allocating_a_teacher_succeeds_and_reports_no_warnings(self) -> None:
        self.allow("academics.teacher-allocation.create", "academics.teacher-allocation.view")

        response = self.client.post(
            "/api/v1/teacher-subject-allocations", self._payload(), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        body = response.json()
        self.assertEqual(body["meta"]["warnings"], [])
        with tenant_context(self.tenant.id):
            self.assertEqual(TeacherSubjectAllocation.objects.alive().count(), 1)

    def test_a_subject_outside_the_class_curriculum_is_rejected(self) -> None:
        """§11 — otherwise timetable would schedule a subject the class never studies."""
        self.allow("academics.teacher-allocation.create")
        with tenant_context(self.tenant.id):
            unrelated = SubjectFactory(tenant=self.tenant)

        response = self.client.post(
            "/api/v1/teacher-subject-allocations",
            self._payload(subject_id=str(unrelated.pk)),
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        fields = {detail["field"] for detail in response.json()["error"]["details"]}
        self.assertIn("subject_id", fields)

    def test_non_teaching_staff_cannot_be_allocated(self) -> None:
        self.allow("academics.teacher-allocation.create")
        with tenant_context(self.tenant.id):
            admin_staff = StaffFactory(
                tenant=self.tenant, campus=self.campus, staff_type=StaffType.NON_TEACHING
            )

        response = self.client.post(
            "/api/v1/teacher-subject-allocations",
            self._payload(staff_id=str(admin_staff.pk)),
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_an_exited_teacher_cannot_be_allocated(self) -> None:
        self.allow("academics.teacher-allocation.create")
        with tenant_context(self.tenant.id):
            self.teacher.employment_status = EmploymentStatus.RESIGNED
            self.teacher.save(update_fields=["employment_status"])

        response = self.client.post(
            "/api/v1/teacher-subject-allocations", self._payload(), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_a_new_primary_end_dates_the_previous_one(self) -> None:
        """§6: reassignment preserves history rather than deleting it."""
        self.allow("academics.teacher-allocation.create")
        self.client.post("/api/v1/teacher-subject-allocations", self._payload(), format="json")

        with tenant_context(self.tenant.id):
            replacement = StaffFactory(tenant=self.tenant, campus=self.campus)
        self.client.post(
            "/api/v1/teacher-subject-allocations",
            self._payload(staff_id=str(replacement.pk)),
            format="json",
        )

        with tenant_context(self.tenant.id):
            old = TeacherSubjectAllocation.objects.alive().get(staff=self.teacher)
            new = TeacherSubjectAllocation.objects.alive().get(staff=replacement)
        self.assertIsNotNone(old.effective_to, "the outgoing primary should be end-dated")
        self.assertIsNone(new.effective_to)
        self.assertTrue(new.is_primary)

    def test_load_summary_aggregates_weekly_periods(self) -> None:
        self.allow("academics.teacher-allocation.create", "academics.teacher-allocation.view")
        self.client.post("/api/v1/teacher-subject-allocations", self._payload(), format="json")

        response = self.client.get(
            f"/api/v1/teacher-subject-allocations/load-summary"
            f"?academic_session_id={self.session.pk}"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        rows = response.json()["data"]
        self.assertEqual(len(rows), 1)
        # ClassSubjectFactory's default weekly_periods is 4.
        self.assertEqual(rows[0]["weekly_periods"], 4)
        self.assertFalse(rows[0]["over_norm"])

    def test_load_summary_requires_a_session(self) -> None:
        self.allow("academics.teacher-allocation.view")

        response = self.client.get("/api/v1/teacher-subject-allocations/load-summary")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_an_allocation_override_wins_over_the_curriculum_target(self) -> None:
        self.allow("academics.teacher-allocation.create", "academics.teacher-allocation.view")
        self.client.post(
            "/api/v1/teacher-subject-allocations",
            self._payload(weekly_periods=9),
            format="json",
        )

        response = self.client.get(
            f"/api/v1/teacher-subject-allocations/load-summary"
            f"?academic_session_id={self.session.pk}"
        )

        self.assertEqual(response.json()["data"][0]["weekly_periods"], 9)

    def test_over_norm_allocations_warn_but_still_save(self) -> None:
        """Warnings, not a 422 — a grid mid-build has to be savable."""
        self.allow("academics.teacher-allocation.create")
        with tenant_context(self.tenant.id):
            for _ in range(4):
                subject = SubjectFactory(tenant=self.tenant)
                ClassSubjectFactory(
                    tenant=self.tenant,
                    academic_session=self.session,
                    school_class=self.school_class,
                    subject=subject,
                    weekly_periods=10,
                )
                TeacherAllocationFactory(
                    tenant=self.tenant,
                    academic_session=self.session,
                    section=self.section,
                    subject=subject,
                    staff=self.teacher,
                )

        response = self.client.post(
            "/api/v1/teacher-subject-allocations", self._payload(), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        warnings = response.json()["meta"]["warnings"]
        self.assertEqual(warnings[0]["code"], "teacher_over_norm")
