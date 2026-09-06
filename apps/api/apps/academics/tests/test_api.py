"""API-level tests for curriculum, teacher allocation and promotion-batch listing."""

from __future__ import annotations

import datetime
import uuid
from unittest import mock

from django.utils import timezone
from rest_framework import status

from apps.academics.models import PromotionStatus, StudentPromotion, TeacherSubjectAllocation
from apps.academics.tests.base import AcademicsAPITestCase
from apps.academics.tests.factories import (
    ClassSubjectFactory,
    StaffFactory,
    StudentPromotionFactory,
    SubjectFactory,
    TeacherAllocationFactory,
)
from apps.school_organization import services as school_services
from apps.school_organization.models import ClassSubject, SessionStatus, Subject
from apps.staff_management.models import EmploymentStatus, StaffType
from apps.student_management.tests.factories import StudentEnrollmentFactory, StudentFactory
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
        """400 with the field named, not the service's 422.

        `map_subject_to_class` raises `DomainRuleViolation` for this too, but the
        serializer's field validator runs first and never lets it get there — and
        that is the better answer. `weekly_periods >= 1` is a constraint on the
        value itself, needing no other state to decide, which is what separates a
        400 from a 422 in the envelope contract. The form gets a field to
        highlight rather than a bare message.
        """
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

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn(
            "weekly_periods",
            {row["field"] for row in response.json()["error"]["details"]},
        )

    def test_an_elective_mapping_needs_a_group(self) -> None:
        """400 with the field named, which the ownership move had quietly cost.

        `map_subject_to_class` enforces this too, but with a bare string — so
        once the endpoint moved here and the serializer stopped checking, the
        form got a 422 on `non_field` where it used to get a 400 on
        `elective_group`. The serializer checks again, which also covers the
        PATCH path the service never sees.
        """
        self.allow("academics.curriculum.create")
        with tenant_context(self.tenant.id):
            other_subject = SubjectFactory(tenant=self.tenant)

        response = self.client.post(
            "/api/v1/class-subjects",
            {
                "academic_session_id": str(self.session.pk),
                "class_id": str(self.school_class.pk),
                "subject_id": str(other_subject.pk),
                "weekly_periods": 4,
                "is_elective": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn(
            "elective_group",
            {row["field"] for row in response.json()["error"]["details"]},
        )

    def test_an_inactive_subject_cannot_be_mapped(self) -> None:
        """422, unlike the two above: whether a subject is active is state on
        another row, so it is a domain rule rather than a field constraint."""
        self.allow("academics.curriculum.create")
        with tenant_context(self.tenant.id):
            other_subject = SubjectFactory(tenant=self.tenant, is_active=False)

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


class CurriculumElectiveGroupTests(AcademicsAPITestCase):
    """§11's "an elective group needs at least two options", on the *edit* path.

    The rule was wired into `perform_destroy` only, so a PATCH could take the
    last row out of a group by renaming its `elective_group` and shrink the group
    with nothing noticing. The check cannot live in `CurriculumSerializer` —
    what decides it is the siblings the row leaves behind, not the payload.
    """

    def _elective(self, group: str) -> ClassSubject:
        with tenant_context(self.tenant.id):
            return ClassSubjectFactory(
                tenant=self.tenant,
                academic_session=self.session,
                school_class=self.school_class,
                subject=SubjectFactory(tenant=self.tenant),
                is_elective=True,
                elective_group=group,
            )

    def test_a_patch_may_not_take_the_last_row_out_of_a_group(self) -> None:
        self.allow("academics.curriculum.update")
        sole = self._elective("Languages")

        response = self.client.patch(
            f"/api/v1/class-subjects/{sole.pk}", {"elective_group": "Arts"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn(
            "elective_group",
            {row["field"] for row in response.json()["error"]["details"]},
        )
        with tenant_context(self.tenant.id):
            sole.refresh_from_db()
        self.assertEqual(sole.elective_group, "Languages", "the refused PATCH must not have saved")

    def test_a_patch_that_leaves_the_group_populated_is_allowed(self) -> None:
        self.allow("academics.curriculum.update")
        moving = self._elective("Languages")
        self._elective("Languages")

        response = self.client.patch(
            f"/api/v1/class-subjects/{moving.pk}", {"elective_group": "Arts"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            moving.refresh_from_db()
        self.assertEqual(moving.elective_group, "Arts")

    def test_a_patch_that_leaves_the_group_alone_is_untouched_by_the_rule(self) -> None:
        """A group of one is a group being built up — editing it is not removal."""
        self.allow("academics.curriculum.update")
        sole = self._elective("Languages")

        response = self.client.patch(
            f"/api/v1/class-subjects/{sole.pk}", {"notes": "Set in period 6."}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())


class CurriculumDeleteTests(AcademicsAPITestCase):
    """`BlockingDestroyMixin`, which the move from school_organization dropped.

    Nothing has a foreign key to `class_subjects` yet, so `_live_dependents` is
    stubbed rather than a real dependent being built — the regression is the
    missing *wiring*, and stubbing the one query it makes is what lets that be
    asserted before the first module that adds the FK depends on it. `PROTECT`
    is no backstop here either: `perform_destroy` is a soft delete, so the
    database never sees a DELETE to refuse.
    """

    def test_a_row_with_live_dependents_is_refused_with_a_422(self) -> None:
        self.allow("academics.curriculum.delete")

        with mock.patch.object(
            school_services, "_live_dependents", return_value=["timetable entries"]
        ):
            response = self.client.delete(f"/api/v1/class-subjects/{self.curriculum.pk}")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("timetable entries", response.json()["error"]["message"])
        with tenant_context(self.tenant.id):
            self.assertTrue(
                ClassSubject.objects.alive().filter(pk=self.curriculum.pk).exists(),
                "a refused delete must not have soft-deleted the row",
            )

    def test_a_row_nothing_points_at_still_deletes(self) -> None:
        self.allow("academics.curriculum.delete")

        response = self.client.delete(f"/api/v1/class-subjects/{self.curriculum.pk}")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        with tenant_context(self.tenant.id):
            self.assertFalse(ClassSubject.objects.alive().filter(pk=self.curriculum.pk).exists())


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


class CurriculumOrderingTests(AcademicsAPITestCase):
    """`?ordering=` on `/class-subjects`, one case per column the grid renders.

    Ordering is an allowlist (`CurriculumViewSet.ordering_fields`), so these cover
    both halves of it: what is on it sorts, what is not is dropped rather than
    answered with an error.
    """

    def _grid(self) -> None:
        """Four rows whose subject-name and weekly-period orders differ.

        Deliberately different: a sort assertion only proves something if the
        column under test is the one that could have produced that sequence.
        """
        with tenant_context(self.tenant.id):
            # base.py already made one row; both of its sort keys are pinned here
            # so nothing below leans on a factory sequence number to decide where
            # that row lands.
            Subject.objects.filter(pk=self.subject.pk).update(name="Physics")
            ClassSubject.objects.filter(pk=self.curriculum.pk).update(weekly_periods=4)
            for subject_name, periods in (("Zoology", 5), ("Algebra", 7), ("Music", 2)):
                subject = SubjectFactory(tenant=self.tenant, name=subject_name)
                ClassSubjectFactory(
                    tenant=self.tenant,
                    academic_session=self.session,
                    school_class=self.school_class,
                    subject=subject,
                    weekly_periods=periods,
                )

    def _periods(self, query: str) -> list[int]:
        response = self.client.get(f"/api/v1/class-subjects{query}")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return [row["weekly_periods"] for row in response.json()["data"]]

    def test_orders_by_weekly_periods_ascending(self) -> None:
        self.allow("academics.curriculum.view")
        self._grid()

        self.assertEqual(self._periods("?ordering=weekly_periods"), [2, 4, 5, 7])

    def test_orders_by_weekly_periods_descending(self) -> None:
        self.allow("academics.curriculum.view")
        self._grid()

        self.assertEqual(self._periods("?ordering=-weekly_periods"), [7, 5, 4, 2])

    def test_orders_by_the_subject_it_maps(self) -> None:
        """The annotated related sort — `subject_name`, never `subject__name`."""
        self.allow("academics.curriculum.view")
        self._grid()

        # Algebra(7), Music(2), Physics(4), Zoology(5).
        self.assertEqual(self._periods("?ordering=subject_name"), [7, 2, 4, 5])
        self.assertEqual(self._periods("?ordering=-subject_name"), [5, 4, 2, 7])

    def test_an_undeclared_ordering_field_is_ignored_rather_than_an_error(self) -> None:
        """`notes` is on the serializer, so DRF would take it with no allowlist.

        Asserted against an unordered request rather than a literal sequence:
        `ClassSubject.Meta.ordering` ends in `subject_id`, and those are UUIDs, so
        the default order is stable per run but not writable down.
        """
        self.allow("academics.curriculum.view")
        self._grid()

        baseline = self.client.get("/api/v1/class-subjects")
        ignored = self.client.get("/api/v1/class-subjects?ordering=notes")

        self.assertEqual(ignored.status_code, status.HTTP_200_OK, ignored.json())
        self.assertEqual(
            [row["id"] for row in ignored.json()["data"]],
            [row["id"] for row in baseline.json()["data"]],
        )


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


class PromotionBatchOrderingTests(AcademicsAPITestCase):
    """`?ordering=` on `/student-promotions`, which is an aggregate, not a table.

    Two things are being protected here. The obvious one is that the batch list
    declared no `ordering_fields` at all, so DRF accepted a sort on any serializer
    field. The subtle one is that this queryset is a `.values(...).annotate(...)`,
    where an ordering column that is not already selected joins the GROUP BY — the
    list then silently returns one row per *student*, each claiming `students: 1`,
    with a 200 and no error anywhere. Every test below therefore asserts the
    counts as well as the sequence.
    """

    def setUp(self) -> None:
        super().setUp()
        now = timezone.now()
        # Deliberately not in `started_at` order, so the default ordering below is
        # asserting something.
        self.approved = self._batch(
            PromotionStatus.APPROVED, students=3, started_at=now - datetime.timedelta(days=2)
        )
        self.pending = self._batch(
            PromotionStatus.PENDING_APPROVAL,
            students=1,
            started_at=now - datetime.timedelta(days=3),
        )
        self.draft = self._batch(
            PromotionStatus.DRAFT, students=2, started_at=now - datetime.timedelta(days=1)
        )

    def _batch(self, batch_status: str, *, students: int, started_at) -> str:
        """One batch of `students` rows, written through the factories.

        Not through `POST /student-promotions`: that service builds a batch from
        whatever the class currently enrolls, and these tests need a specific
        row count, status and age per batch.
        """
        batch_id = uuid.uuid4()
        with tenant_context(self.tenant.id):
            for _ in range(students):
                student = StudentFactory(tenant=self.tenant, campus=self.campus)
                enrollment = StudentEnrollmentFactory(
                    tenant=self.tenant,
                    student=student,
                    academic_session=self.session,
                    school_class=self.school_class,
                    section=self.section,
                )
                StudentPromotionFactory(
                    tenant=self.tenant,
                    batch_id=batch_id,
                    student=student,
                    from_enrollment=enrollment,
                    from_academic_session=self.session,
                    to_academic_session=self.next_session,
                    from_class=self.school_class,
                    to_class=self.next_class,
                    status=batch_status,
                )
            # `created_at` is auto_now_add, so it can only be moved after the fact;
            # `started_at` is its Min over the batch.
            StudentPromotion.objects.filter(batch_id=batch_id).update(created_at=started_at)
        return str(batch_id)

    def _rows(self, query: str = "") -> list[tuple[str, int]]:
        """(batch_id, students) per row — the sequence and the grouping together."""
        response = self.client.get(f"/api/v1/student-promotions{query}")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return [(row["batch_id"], row["students"]) for row in response.json()["data"]]

    def test_the_default_order_is_newest_batch_first(self) -> None:
        """`get_queryset`'s own `-started_at`, untouched when no `?ordering=` arrives."""
        self.allow("academics.promotion.view")

        self.assertEqual(
            self._rows(),
            [(self.draft, 2), (self.approved, 3), (self.pending, 1)],
        )

    def test_orders_by_status_ascending(self) -> None:
        self.allow("academics.promotion.view")

        # approved, draft, pending_approval — and still one row per batch.
        self.assertEqual(
            self._rows("?ordering=status"),
            [(self.approved, 3), (self.draft, 2), (self.pending, 1)],
        )

    def test_orders_by_status_descending(self) -> None:
        self.allow("academics.promotion.view")

        self.assertEqual(
            self._rows("?ordering=-status"),
            [(self.pending, 1), (self.draft, 2), (self.approved, 3)],
        )

    def test_orders_by_the_student_count_annotation(self) -> None:
        self.allow("academics.promotion.view")

        self.assertEqual(
            self._rows("?ordering=students"),
            [(self.pending, 1), (self.draft, 2), (self.approved, 3)],
        )
        self.assertEqual(
            self._rows("?ordering=-students"),
            [(self.approved, 3), (self.draft, 2), (self.pending, 1)],
        )

    def test_orders_by_the_started_at_annotation(self) -> None:
        self.allow("academics.promotion.view")

        self.assertEqual(
            self._rows("?ordering=started_at"),
            [(self.pending, 1), (self.approved, 3), (self.draft, 2)],
        )

    def test_ordering_does_not_regroup_the_aggregate(self) -> None:
        """The regression this endpoint's ordering allowlist exists for.

        A sort column that is not in the `values()` set is added to the GROUP BY,
        and on Postgres a primary key there collapses the grouping to one row per
        promotion row. The symptom is not an error: it is three batches becoming
        six rows, each reporting a single student. Asserting the counts is what
        makes any of these tests notice.
        """
        self.allow("academics.promotion.view")

        rows = self._rows("?ordering=status")

        self.assertEqual(len(rows), 3)
        self.assertEqual(sorted(count for _, count in rows), [1, 2, 3])

    def test_an_undeclared_ordering_field_is_ignored_rather_than_an_error(self) -> None:
        """`created_at` is exactly the field that would un-group this list.

        It is on the model and on every other list in this module, which is what
        makes it worth pinning: dropped here, the default `-started_at` stands and
        the batches stay batches.
        """
        self.allow("academics.promotion.view")

        self.assertEqual(
            self._rows("?ordering=created_at"),
            [(self.draft, 2), (self.approved, 3), (self.pending, 1)],
        )

    def test_a_batch_detail_ignores_an_ordering_only_the_list_can_serve(self) -> None:
        """`retrieve` runs the same backend over the un-aggregated decision rows.

        `students` is on the allowlist because the *list* is an aggregate. The
        detail route's queryset has no such column, so ordering by it there is a
        FieldError — a 500 off a query parameter rather than a batch.
        """
        self.allow("academics.promotion.view")

        response = self.client.get(f"/api/v1/student-promotions/{self.approved}?ordering=students")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["students"], 3)
