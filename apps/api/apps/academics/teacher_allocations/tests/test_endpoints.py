"""Teacher allocations — HTTP endpoint round trips and `?ordering=` on
`/teacher-subject-allocations`."""

from __future__ import annotations

import datetime

from django.utils import timezone
from rest_framework import status

from apps.academics.models import TeacherSubjectAllocation
from apps.academics.tests.base import AcademicsAPITestCase
from apps.academics.tests.factories import (
    ClassSubjectFactory,
    StaffFactory,
    SubjectFactory,
    TeacherAllocationFactory,
)
from apps.staff_management.models import EmploymentStatus, StaffType
from core.tenancy.context import tenant_context


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

    def test_an_allocation_that_starts_next_term_does_not_count_yet(self) -> None:
        """§11's load warning is about the load a teacher is carrying *now*.

        `effective_to IS NULL` also matches an allocation that has not started,
        so counting every open-ended row let next term's timetable inflate this
        term's number and fire the over-norm warning on nobody's actual load.
        """
        self.allow("academics.teacher-allocation.create", "academics.teacher-allocation.view")
        self.client.post("/api/v1/teacher-subject-allocations", self._payload(), format="json")
        with tenant_context(self.tenant.id):
            next_term_subject = SubjectFactory(tenant=self.tenant)
            ClassSubjectFactory(
                tenant=self.tenant,
                academic_session=self.session,
                school_class=self.school_class,
                subject=next_term_subject,
                weekly_periods=10,
            )
            TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=self.section,
                subject=next_term_subject,
                staff=self.teacher,
                is_primary=False,
                effective_from=timezone.localdate() + datetime.timedelta(days=30),
            )

        response = self.client.get(
            f"/api/v1/teacher-subject-allocations/load-summary"
            f"?academic_session_id={self.session.pk}"
        )

        # The 4 periods being taught, not 4 + the 10 that start next month.
        self.assertEqual(response.json()["data"][0]["weekly_periods"], 4)

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


class TeacherAllocationOrderingTests(AcademicsAPITestCase):
    """`?ordering=` on `/teacher-subject-allocations`.

    `staff_last_name` is the case that matters most here: it is annotated in
    `get_queryset` rather than traversed, because this is the one list in the
    module a teacher reaches on the `own` record scope.
    """

    def _allocations(self) -> None:
        with tenant_context(self.tenant.id):
            rows = (
                ("Yusuf", "Zoology", datetime.date(2026, 4, 1), 5),
                ("Ahmed", "Algebra", datetime.date(2026, 4, 2), 9),
                ("Malik", "Music", datetime.date(2026, 4, 3), 3),
            )
            for last_name, subject_name, effective_from, weekly_periods in rows:
                subject = SubjectFactory(tenant=self.tenant, name=subject_name)
                staff = StaffFactory(tenant=self.tenant, campus=self.campus, last_name=last_name)
                TeacherAllocationFactory(
                    tenant=self.tenant,
                    academic_session=self.session,
                    section=self.section,
                    subject=subject,
                    staff=staff,
                    effective_from=effective_from,
                    weekly_periods=weekly_periods,
                )

    def _effective_from(self, query: str) -> list[str]:
        response = self.client.get(f"/api/v1/teacher-subject-allocations{query}")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return [row["effective_from"] for row in response.json()["data"]]

    def test_orders_by_effective_from_ascending(self) -> None:
        self.allow("academics.teacher-allocation.view")
        self._allocations()

        self.assertEqual(
            self._effective_from("?ordering=effective_from"),
            ["2026-04-01", "2026-04-02", "2026-04-03"],
        )

    def test_orders_by_effective_from_descending(self) -> None:
        self.allow("academics.teacher-allocation.view")
        self._allocations()

        self.assertEqual(
            self._effective_from("?ordering=-effective_from"),
            ["2026-04-03", "2026-04-02", "2026-04-01"],
        )

    def test_orders_by_weekly_periods(self) -> None:
        self.allow("academics.teacher-allocation.view")
        self._allocations()

        # Malik(3), Yusuf(5), Ahmed(9).
        self.assertEqual(
            self._effective_from("?ordering=weekly_periods"),
            ["2026-04-03", "2026-04-01", "2026-04-02"],
        )

    def test_orders_by_the_teacher_it_belongs_to(self) -> None:
        """The annotated related sort — `staff_last_name`, never `staff__last_name`."""
        self.allow("academics.teacher-allocation.view")
        self._allocations()

        # Ahmed, Malik, Yusuf.
        self.assertEqual(
            self._effective_from("?ordering=staff_last_name"),
            ["2026-04-02", "2026-04-03", "2026-04-01"],
        )
        self.assertEqual(
            self._effective_from("?ordering=-staff_last_name"),
            ["2026-04-01", "2026-04-03", "2026-04-02"],
        )

    def test_an_undeclared_ordering_field_is_ignored_rather_than_an_error(self) -> None:
        """`academic_session_id` is on the serializer but not on the allowlist.

        Compared against an unordered request for the same reason the curriculum
        test is: `TeacherSubjectAllocation.Meta.ordering` is over UUID columns.
        """
        self.allow("academics.teacher-allocation.view")
        self._allocations()

        baseline = self.client.get("/api/v1/teacher-subject-allocations")
        ignored = self.client.get(
            "/api/v1/teacher-subject-allocations?ordering=academic_session_id"
        )

        self.assertEqual(ignored.status_code, status.HTTP_200_OK, ignored.json())
        self.assertEqual(
            [row["id"] for row in ignored.json()["data"]],
            [row["id"] for row in baseline.json()["data"]],
        )
