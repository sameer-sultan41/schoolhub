"""Teacher allocations — HTTP endpoint round trips and `?ordering=` on
`/teacher-subject-allocations`."""

from __future__ import annotations

import datetime
import uuid
from unittest import mock

from django.utils import timezone
from rest_framework import status

from apps.academics.models import TeacherSubjectAllocation
from apps.academics.teacher_allocations import services
from apps.academics.tests.base import AcademicsAPITestCase
from apps.academics.tests.factories import (
    CampusFactory,
    ClassSubjectFactory,
    SectionFactory,
    StaffFactory,
    SubjectFactory,
    TeacherAllocationFactory,
)
from apps.school_organization.models import SessionStatus, Subject
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

    def _allocate(self, **overrides) -> dict:
        self.allow(
            "academics.teacher-allocation.create",
            "academics.teacher-allocation.update",
            "academics.teacher-allocation.delete",
            "academics.teacher-allocation.view",
        )
        response = self.client.post(
            "/api/v1/teacher-subject-allocations", self._payload(**overrides), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        return response.json()["data"]

    def _close_session(self) -> None:
        with tenant_context(self.tenant.id):
            self.session.status = SessionStatus.CLOSED
            self.session.save(update_fields=["status"])

    def _add_curriculum_subject(self) -> Subject:
        """A second subject in the class's curriculum, so a row can be moved onto it."""
        with tenant_context(self.tenant.id):
            subject = SubjectFactory(tenant=self.tenant)
            ClassSubjectFactory(
                tenant=self.tenant,
                academic_session=self.session,
                school_class=self.school_class,
                subject=subject,
            )
        return subject

    def _patch(self, allocation_id: str, body: dict):
        return self.client.patch(
            f"/api/v1/teacher-subject-allocations/{allocation_id}", body, format="json"
        )

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

    def test_a_patch_on_a_closed_session_is_refused(self) -> None:
        row = self._allocate()
        self._close_session()
        self.assertEqual(
            self._patch(row["id"], {"weekly_periods": 4}).status_code,
            status.HTTP_422_UNPROCESSABLE_ENTITY,
        )

    def test_a_delete_on_a_closed_session_is_refused(self) -> None:
        row = self._allocate()
        self._close_session()
        response = self.client.delete(f"/api/v1/teacher-subject-allocations/{row['id']}")
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        with tenant_context(self.tenant.id):
            self.assertTrue(
                TeacherSubjectAllocation.objects.alive().filter(pk=row["id"]).exists(),
                "a refused delete must not have soft-deleted the row",
            )

    def test_a_patch_to_a_non_teaching_staff_member_is_refused(self) -> None:
        row = self._allocate()
        with tenant_context(self.tenant.id):
            clerk = StaffFactory(
                tenant=self.tenant, campus=self.campus, staff_type=StaffType.NON_TEACHING
            )
        response = self._patch(row["id"], {"staff_id": str(clerk.pk)})
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("staff_id", {d["field"] for d in response.json()["error"]["details"]})

    def test_a_patch_to_a_subject_outside_the_curriculum_is_refused(self) -> None:
        row = self._allocate()
        with tenant_context(self.tenant.id):
            unrelated = SubjectFactory(tenant=self.tenant)
        response = self._patch(row["id"], {"subject_id": str(unrelated.pk)})
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("subject_id", {d["field"] for d in response.json()["error"]["details"]})

    def test_making_a_co_teacher_primary_end_dates_the_current_primary(self) -> None:
        """§6 history on PATCH — previously the one-primary constraint surfaced as a 409."""
        primary = self._allocate()
        with tenant_context(self.tenant.id):
            co = StaffFactory(tenant=self.tenant, campus=self.campus)
        co_row = self._allocate(staff_id=str(co.pk), is_primary=False)
        response = self._patch(co_row["id"], {"is_primary": True})
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            old = TeacherSubjectAllocation.objects.get(pk=primary["id"])
        self.assertIsNotNone(old.effective_to)

    def test_promoting_a_co_teacher_who_has_since_gone_inactive_is_refused(self) -> None:
        """Neither `staff` nor the slot changes on a bare `{is_primary: true}` PATCH, so
        the active-teacher re-check has to run off `becoming_active`, not the diff."""
        self._allocate()
        with tenant_context(self.tenant.id):
            co = StaffFactory(tenant=self.tenant, campus=self.campus)
        co_row = self._allocate(staff_id=str(co.pk), is_primary=False)
        with tenant_context(self.tenant.id):
            co.employment_status = EmploymentStatus.RESIGNED
            co.save(update_fields=["employment_status"])

        response = self._patch(co_row["id"], {"is_primary": True})

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("staff_id", {d["field"] for d in response.json()["error"]["details"]})

    def test_editing_an_active_allocation_whose_teacher_has_since_gone_inactive_is_allowed(
        self,
    ) -> None:
        """Only Reinstate and promote-to-primary re-check the teacher; an unrelated edit must
        not fail on something that changed elsewhere."""
        row = self._allocate()
        with tenant_context(self.tenant.id):
            self.teacher.employment_status = EmploymentStatus.RESIGNED
            self.teacher.save(update_fields=["employment_status"])

        response = self._patch(row["id"], {"weekly_periods": 3})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

    def test_editing_an_active_allocation_whose_subject_left_the_curriculum_is_allowed(
        self,
    ) -> None:
        row = self._allocate()
        with tenant_context(self.tenant.id):
            self.curriculum.delete()

        response = self._patch(row["id"], {"weekly_periods": 3})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

    def test_moving_a_primary_onto_a_subject_with_a_primary_end_dates_that_primary(self) -> None:
        """slot_changed: the moved row takes the slot as on create, not a 409 on one-primary."""
        other_subject = self._add_curriculum_subject()
        with tenant_context(self.tenant.id):
            incumbent_teacher = StaffFactory(tenant=self.tenant, campus=self.campus)
        mover = self._allocate()
        incumbent = self._allocate(
            subject_id=str(other_subject.pk), staff_id=str(incumbent_teacher.pk)
        )
        with tenant_context(self.tenant.id):
            self.assertIsNone(TeacherSubjectAllocation.objects.get(pk=incumbent["id"]).effective_to)

        response = self._patch(mover["id"], {"subject_id": str(other_subject.pk)})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            displaced = TeacherSubjectAllocation.objects.get(pk=incumbent["id"])
            moved = TeacherSubjectAllocation.objects.get(pk=mover["id"])
        self.assertIsNotNone(displaced.effective_to, "the displaced primary should be end-dated")
        self.assertEqual(moved.subject_id, other_subject.pk)
        self.assertTrue(moved.is_primary)
        self.assertIsNone(moved.effective_to)

    def test_moving_a_co_teacher_onto_a_taken_subject_leaves_its_primary_alone(self) -> None:
        """Negative control: only a row that becomes the current primary displaces one."""
        other_subject = self._add_curriculum_subject()
        with tenant_context(self.tenant.id):
            incumbent_teacher = StaffFactory(tenant=self.tenant, campus=self.campus)
            co_teacher = StaffFactory(tenant=self.tenant, campus=self.campus)
        co_row = self._allocate(staff_id=str(co_teacher.pk), is_primary=False)
        incumbent = self._allocate(
            subject_id=str(other_subject.pk), staff_id=str(incumbent_teacher.pk)
        )

        response = self._patch(co_row["id"], {"subject_id": str(other_subject.pk)})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            untouched = TeacherSubjectAllocation.objects.get(pk=incumbent["id"])
            moved = TeacherSubjectAllocation.objects.get(pk=co_row["id"])
        self.assertIsNone(untouched.effective_to)
        self.assertEqual(moved.subject_id, other_subject.pk)
        self.assertFalse(moved.is_primary)

    def test_ending_an_allocation_sets_effective_to_and_drops_it_from_the_load(self) -> None:
        row = self._allocate()
        today = timezone.localdate().isoformat()
        response = self._patch(row["id"], {"effective_to": today})
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["effective_to"], today)
        summary = self.client.get(
            "/api/v1/teacher-subject-allocations/load-summary",
            {"academic_session_id": str(self.session.pk)},
        ).json()["data"]
        self.assertEqual(summary, [])

    def test_a_future_end_date_is_refused(self) -> None:
        row = self._allocate()
        tomorrow = (timezone.localdate() + datetime.timedelta(days=1)).isoformat()
        response = self._patch(row["id"], {"effective_to": tomorrow})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("effective_to", {d["field"] for d in response.json()["error"]["details"]})

    def test_an_end_date_before_the_start_is_refused(self) -> None:
        start = timezone.localdate() - datetime.timedelta(days=5)
        row = self._allocate(effective_from=start.isoformat())
        before = (start - datetime.timedelta(days=1)).isoformat()
        response = self._patch(row["id"], {"effective_to": before})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("effective_to", {d["field"] for d in response.json()["error"]["details"]})

    def test_effective_to_is_refused_on_create(self) -> None:
        self.allow("academics.teacher-allocation.create")
        response = self.client.post(
            "/api/v1/teacher-subject-allocations",
            self._payload(effective_to=timezone.localdate().isoformat()),
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_null_effective_to_on_create_is_accepted_and_stays_open(self) -> None:
        """The generated POST schema lists `effective_to` as nullable; only a date is refused."""
        self.allow("academics.teacher-allocation.create")
        response = self.client.post(
            "/api/v1/teacher-subject-allocations",
            self._payload(effective_to=None),
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        self.assertIsNone(response.json()["data"]["effective_to"])

    def _displaced_future_start_row(self) -> tuple[dict, datetime.date]:
        """A primary lined up for later, then displaced: its `effective_to` is its own start."""
        future = timezone.localdate() + datetime.timedelta(days=30)
        first = self._allocate(effective_from=future.isoformat())
        with tenant_context(self.tenant.id):
            replacement = StaffFactory(tenant=self.tenant, campus=self.campus)
        self._allocate(staff_id=str(replacement.pk))
        return first, future

    def test_a_patch_leaves_a_future_end_date_alone_when_it_is_not_being_set(self) -> None:
        """A primary displaced from a future start carries that future date as its end."""
        first, _ = self._displaced_future_start_row()
        response = self._patch(first["id"], {"weekly_periods": 2})
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

    def test_moving_only_the_start_of_a_displaced_future_start_row_is_allowed(self) -> None:
        first, future = self._displaced_future_start_row()
        earlier = (future - datetime.timedelta(days=10)).isoformat()
        response = self._patch(first["id"], {"effective_from": earlier})
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["effective_from"], earlier)
        self.assertEqual(response.json()["data"]["effective_to"], future.isoformat())

    def test_a_start_after_the_existing_end_is_refused_on_effective_to(self) -> None:
        first, future = self._displaced_future_start_row()
        later = (future + datetime.timedelta(days=5)).isoformat()
        response = self._patch(first["id"], {"effective_from": later})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("effective_to", {d["field"] for d in response.json()["error"]["details"]})

    def test_a_future_end_date_is_still_refused_on_a_displaced_future_start_row(self) -> None:
        first, future = self._displaced_future_start_row()
        later = (future + datetime.timedelta(days=10)).isoformat()
        response = self._patch(first["id"], {"effective_to": later})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("effective_to", {d["field"] for d in response.json()["error"]["details"]})

    def test_reinstating_an_ended_primary_end_dates_the_current_primary(self) -> None:
        """Reopening is how a teacher gets the same pair back — tsa_unique_allocation
        ignores effective_to, so a second POST for the same staff would 409."""
        first = self._allocate()
        with tenant_context(self.tenant.id):
            replacement = StaffFactory(tenant=self.tenant, campus=self.campus)
        second = self._allocate(staff_id=str(replacement.pk))  # end-dates `first`
        response = self._patch(first["id"], {"effective_to": None})
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            self.assertIsNotNone(TeacherSubjectAllocation.objects.get(pk=second["id"]).effective_to)
            self.assertIsNone(TeacherSubjectAllocation.objects.get(pk=first["id"]).effective_to)

    def test_reinstating_an_allocation_for_a_now_inactive_teacher_is_refused(self) -> None:
        """`staff` doesn't change on `{effective_to: null}` either — same `becoming_active`
        gap as the promote-to-primary case above, for the Reinstate path instead."""
        row = self._allocate()
        end_response = self._patch(row["id"], {"effective_to": timezone.localdate().isoformat()})
        self.assertEqual(end_response.status_code, status.HTTP_200_OK, end_response.json())
        with tenant_context(self.tenant.id):
            self.teacher.employment_status = EmploymentStatus.RESIGNED
            self.teacher.save(update_fields=["employment_status"])

        response = self._patch(row["id"], {"effective_to": None})

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("staff_id", {d["field"] for d in response.json()["error"]["details"]})

    def test_reinstating_an_allocation_for_a_dropped_curriculum_subject_is_refused(self) -> None:
        row = self._allocate()
        end_response = self._patch(row["id"], {"effective_to": timezone.localdate().isoformat()})
        self.assertEqual(end_response.status_code, status.HTTP_200_OK, end_response.json())
        with tenant_context(self.tenant.id):
            self.curriculum.delete()

        response = self._patch(row["id"], {"effective_to": None})

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("subject_id", {d["field"] for d in response.json()["error"]["details"]})

    def test_replacing_a_primary_that_starts_in_the_future_is_not_a_conflict(self) -> None:
        """The outgoing row is end-dated at its own start, never before it."""
        future = (timezone.localdate() + datetime.timedelta(days=30)).isoformat()
        first = self._allocate(effective_from=future)
        with tenant_context(self.tenant.id):
            replacement = StaffFactory(tenant=self.tenant, campus=self.campus)
        self._allocate(staff_id=str(replacement.pk))
        with tenant_context(self.tenant.id):
            old = TeacherSubjectAllocation.objects.get(pk=first["id"])
        self.assertEqual(old.effective_to.isoformat(), future)

    def test_a_patch_reports_load_warnings(self) -> None:
        row = self._allocate()
        body = self._patch(row["id"], {"weekly_periods": 40}).json()
        self.assertEqual(body["meta"]["warnings"][0]["code"], "teacher_over_norm")

    def test_a_patch_notifies_only_when_the_teacher_changed(self) -> None:
        row = self._allocate()
        with tenant_context(self.tenant.id):
            replacement = StaffFactory(tenant=self.tenant, campus=self.campus)

        with mock.patch.object(services, "notify_allocation_changed") as notify:
            same_teacher = self._patch(row["id"], {"weekly_periods": 2})
            self.assertEqual(same_teacher.status_code, status.HTTP_200_OK, same_teacher.json())
            notify.assert_not_called()
            new_teacher = self._patch(row["id"], {"staff_id": str(replacement.pk)})
            self.assertEqual(new_teacher.status_code, status.HTTP_200_OK, new_teacher.json())
            notify.assert_called_once()

    def test_create_and_patch_responses_carry_names(self) -> None:
        """Those instances never pass through get_queryset's annotations."""
        row = self._allocate()
        self.assertEqual(row["section_name"], self.section.name)
        self.assertEqual(row["subject_name"], self.subject.name)
        self.assertEqual(row["class_name"], self.school_class.name)
        self.assertEqual(row["class_id"], str(self.school_class.pk))
        self.assertEqual(row["staff_name"], f"{self.teacher.first_name} {self.teacher.last_name}")
        patched = self._patch(row["id"], {"weekly_periods": 2}).json()["data"]
        self.assertEqual(patched["section_name"], self.section.name)

    def test_filters_by_class_campus_and_current(self) -> None:
        row = self._allocate()
        url = "/api/v1/teacher-subject-allocations"
        self.assertEqual(
            len(self.client.get(url, {"class_id": str(self.school_class.pk)}).json()["data"]), 1
        )
        self.assertEqual(
            len(self.client.get(url, {"class_id": str(self.next_class.pk)}).json()["data"]), 0
        )
        self.assertEqual(
            len(self.client.get(url, {"campus_id": str(self.campus.pk)}).json()["data"]), 1
        )
        with tenant_context(self.tenant.id):
            other_campus = CampusFactory(tenant=self.tenant)
        self.assertEqual(
            len(self.client.get(url, {"campus_id": str(other_campus.pk)}).json()["data"]), 0
        )
        self._patch(row["id"], {"effective_to": timezone.localdate().isoformat()})
        self.assertEqual(len(self.client.get(url, {"current": "true"}).json()["data"]), 0)
        self.assertEqual(len(self.client.get(url, {"current": "false"}).json()["data"]), 1)

    def test_search_matches_teacher_subject_and_section_names(self) -> None:
        """Two rows, so a term that matches one proves the filter discriminates at all."""
        with tenant_context(self.tenant.id):
            qureshi = StaffFactory(
                tenant=self.tenant, campus=self.campus, first_name="Amina", last_name="Qureshi"
            )
            sethi = StaffFactory(
                tenant=self.tenant, campus=self.campus, first_name="Hira", last_name="Sethi"
            )
            physics = SubjectFactory(tenant=self.tenant, name="Physics")
            chemistry = SubjectFactory(tenant=self.tenant, name="Chemistry")
            orchid = SectionFactory(
                tenant=self.tenant,
                school_class=self.school_class,
                campus=self.campus,
                name="Orchid",
            )
            for subject in (physics, chemistry):
                ClassSubjectFactory(
                    tenant=self.tenant,
                    academic_session=self.session,
                    school_class=self.school_class,
                    subject=subject,
                )
        self._allocate(staff_id=str(qureshi.pk), subject_id=str(physics.pk))
        self._allocate(
            staff_id=str(sethi.pk), subject_id=str(chemistry.pk), section_id=str(orchid.pk)
        )

        def found(term: str) -> list[str]:
            response = self.client.get("/api/v1/teacher-subject-allocations", {"search": term})
            return [row["staff_id"] for row in response.json()["data"]]

        self.assertEqual(len(found("")), 2)
        self.assertEqual(found("Qureshi"), [str(qureshi.pk)])
        self.assertEqual(found("Sethi"), [str(sethi.pk)])
        self.assertEqual(found("Amina"), [str(qureshi.pk)])
        self.assertEqual(found("Chemistry"), [str(sethi.pk)])
        self.assertEqual(found("Orchid"), [str(sethi.pk)])
        self.assertEqual(found("Nobody"), [])

    def test_load_summary_rows_carry_the_norm(self) -> None:
        self._allocate()
        row = self.client.get(
            "/api/v1/teacher-subject-allocations/load-summary",
            {"academic_session_id": str(self.session.pk)},
        ).json()["data"][0]
        self.assertEqual(row["norm"], services.DEFAULT_WEEKLY_PERIOD_NORM)

    def test_load_summary_with_a_malformed_session_id_is_a_client_error(self) -> None:
        self.allow("academics.teacher-allocation.view")
        response = self.client.get(
            "/api/v1/teacher-subject-allocations/load-summary", {"academic_session_id": "nope"}
        )
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_load_summary_for_an_unknown_session_is_404(self) -> None:
        self.allow("academics.teacher-allocation.view")
        url = "/api/v1/teacher-subject-allocations/load-summary"

        # Positive control: a real session resolves on the same route.
        known = self.client.get(url, {"academic_session_id": str(self.session.pk)})
        self.assertEqual(known.status_code, status.HTTP_200_OK, known.json())

        unknown = self.client.get(url, {"academic_session_id": str(uuid.uuid4())})
        self.assertEqual(unknown.status_code, status.HTTP_404_NOT_FOUND)


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
