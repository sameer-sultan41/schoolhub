"""API-level tests for rooms, periods, the grid, publishing, and `/timetables/my`."""

from __future__ import annotations

import datetime

from rest_framework import status

from apps.school_organization.models import SessionStatus
from apps.staff_management.models import EmploymentStatus, StaffType
from apps.student_management.models import EnrollmentStatus
from apps.timetable.models import (
    Period,
    Room,
    SlotStatus,
    SubstitutionStatus,
    TimetableSlot,
)
from apps.timetable.tests.base import TimetableAPITestCase
from apps.timetable.tests.factories import (
    MONDAY,
    AcademicSessionFactory,
    CampusFactory,
    GuardianFactory,
    PeriodFactory,
    RoomFactory,
    StaffFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    StudentGuardianFactory,
    SubjectFactory,
    TeacherAllocationFactory,
    TeacherSubstitutionFactory,
    UserFactory,
    authenticate,
    grant,
    period_window,
)
from core.tenancy.context import tenant_context
from core.tenancy.models import TenantFeatureOverride


class RoomEndpointTests(TimetableAPITestCase):
    def test_listing_requires_the_timetable_view_key(self) -> None:
        """§4 declares no `timetable.room.view`; the timetable key stands in."""
        self.assertEqual(self.client.get("/api/v1/rooms").status_code, status.HTTP_403_FORBIDDEN)

        self.allow("timetable.timetable.view")
        self.assertEqual(self.client.get("/api/v1/rooms").status_code, status.HTTP_200_OK)

    def test_creating_a_room_needs_the_create_key_not_the_view_one(self) -> None:
        self.allow("timetable.timetable.view")
        payload = {"campus_id": str(self.campus.pk), "name": "Lab 1", "code": "LAB1"}

        self.assertEqual(
            self.client.post("/api/v1/rooms", payload, format="json").status_code,
            status.HTTP_403_FORBIDDEN,
        )

        self.allow("timetable.room.create")
        response = self.client.post("/api/v1/rooms", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        with tenant_context(self.tenant.id):
            self.assertTrue(Room.objects.alive().filter(code="LAB1").exists())

    def test_a_room_that_seats_nobody_is_rejected(self) -> None:
        """Capacity 0 is storable in a PositiveSmallIntegerField and meaningless."""
        self.allow("timetable.room.create")

        response = self.client.post(
            "/api/v1/rooms",
            {"campus_id": str(self.campus.pk), "name": "Void", "code": "VOID", "capacity": 0},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_patching_a_rooms_capacity(self) -> None:
        self.allow("timetable.room.update", "timetable.timetable.view")

        response = self.client.patch(
            f"/api/v1/rooms/{self.room.pk}", {"capacity": 25}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["capacity"], 25)

    def test_deleting_a_room_is_a_soft_delete(self) -> None:
        self.allow("timetable.room.delete")

        response = self.client.delete(f"/api/v1/rooms/{self.room.pk}")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        with tenant_context(self.tenant.id):
            self.assertFalse(Room.objects.alive().filter(pk=self.room.pk).exists())
            self.assertTrue(Room.objects.filter(pk=self.room.pk).exists())

    def test_rooms_filter_by_campus_and_type(self) -> None:
        self.allow("timetable.timetable.view")
        with tenant_context(self.tenant.id):
            other_campus = CampusFactory(tenant=self.tenant)
            RoomFactory(tenant=self.tenant, campus=other_campus)
            lab = RoomFactory(tenant=self.tenant, campus=self.campus, room_type="lab")

        by_campus = self.client.get(f"/api/v1/rooms?campus_id={self.campus.pk}").json()["data"]
        by_type = self.client.get("/api/v1/rooms?room_type=lab").json()["data"]

        self.assertEqual(len(by_campus), 2)
        self.assertEqual([row["id"] for row in by_type], [str(lab.pk)])


class PeriodEndpointTests(TimetableAPITestCase):
    def _payload(self, **overrides) -> dict:
        base = {"name": "Period 9", "sequence": 90, "start_time": "18:00", "end_time": "18:45"}
        base.update(overrides)
        return base

    def test_creating_a_tenant_wide_period(self) -> None:
        self.allow("timetable.period.create")

        response = self.client.post("/api/v1/periods", self._payload(), format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        self.assertIsNone(response.json()["data"]["campus_id"])

    def test_an_overlapping_period_is_a_domain_rule_violation(self) -> None:
        """§11 — the rule `services.assert_period_does_not_overlap` owns."""
        self.allow("timetable.period.create")
        start, end = period_window(1)

        response = self.client.post(
            "/api/v1/periods",
            self._payload(sequence=91, start_time=start.isoformat(), end_time=end.isoformat()),
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        fields = {detail["field"] for detail in response.json()["error"]["details"]}
        self.assertIn("start_time", fields)

    def test_a_campus_period_still_clashes_with_a_tenant_wide_one(self) -> None:
        """A tenant-wide period applies to this campus too, so it must be compared."""
        self.allow("timetable.period.create")
        start, end = period_window(2)

        response = self.client.post(
            "/api/v1/periods",
            self._payload(
                sequence=92,
                campus_id=str(self.campus.pk),
                start_time=start.isoformat(),
                end_time=end.isoformat(),
            ),
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_an_end_time_before_the_start_is_a_field_error(self) -> None:
        """Mirrors `periods_end_after_start` so the form gets a field, not a 409."""
        self.allow("timetable.period.create")

        response = self.client.post(
            "/api/v1/periods",
            self._payload(start_time="18:00", end_time="17:00"),
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        fields = {detail["field"] for detail in response.json()["error"]["details"]}
        self.assertIn("end_time", fields)

    def test_weekdays_must_be_day_numbers(self) -> None:
        self.allow("timetable.period.create")

        response = self.client.post(
            "/api/v1/periods", self._payload(weekdays={"mon": True}), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_weekdays_out_of_range_are_rejected(self) -> None:
        self.allow("timetable.period.create")

        response = self.client.post(
            "/api/v1/periods", self._payload(weekdays=[0, 1, 9]), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_repeated_weekdays_are_rejected(self) -> None:
        self.allow("timetable.period.create")

        response = self.client.post(
            "/api/v1/periods", self._payload(weekdays=[1, 1]), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_valid_weekday_list_is_accepted(self) -> None:
        self.allow("timetable.period.create")

        response = self.client.post(
            "/api/v1/periods", self._payload(weekdays=[0, 1, 2, 3, 4]), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        self.assertEqual(response.json()["data"]["weekdays"], [0, 1, 2, 3, 4])

    def test_marking_a_period_as_a_break(self) -> None:
        self.allow("timetable.period.create", "timetable.timetable.view")

        response = self.client.post("/api/v1/periods", self._payload(is_break=True), format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        self.assertTrue(response.json()["data"]["is_break"])

    def test_patching_a_period_ignores_its_own_row_when_checking_overlap(self) -> None:
        """Without `exclude_pk` a period would always overlap itself and never be editable."""
        self.allow("timetable.period.update", "timetable.timetable.view")

        response = self.client.patch(
            f"/api/v1/periods/{self.period.pk}", {"name": "Renamed"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["name"], "Renamed")

    def test_deleting_a_period_is_a_soft_delete(self) -> None:
        self.allow("timetable.period.delete")
        with tenant_context(self.tenant.id):
            spare = PeriodFactory(tenant=self.tenant, sequence=93)

        response = self.client.delete(f"/api/v1/periods/{spare.pk}")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        with tenant_context(self.tenant.id):
            self.assertFalse(Period.objects.alive().filter(pk=spare.pk).exists())


class TimetableSlotEndpointTests(TimetableAPITestCase):
    def _payload(self, **overrides) -> dict:
        base = {
            "academic_session_id": str(self.session.pk),
            "section_id": str(self.section.pk),
            "day_of_week": 0,
            "period_id": str(self.period.pk),
            "subject_id": str(self.subject.pk),
            "staff_id": str(self.teacher.pk),
            "room_id": str(self.room.pk),
        }
        base.update(overrides)
        return base

    def test_the_draft_list_takes_the_slot_view_key_not_the_timetable_one(self) -> None:
        """§5.7: an unpublished grid must not leak, so drafts need their own key."""
        self.allow("timetable.timetable.view")

        self.assertEqual(
            self.client.get("/api/v1/timetable-slots").status_code, status.HTTP_403_FORBIDDEN
        )

        self.allow("timetable.slot.view")
        self.assertEqual(self.client.get("/api/v1/timetable-slots").status_code, status.HTTP_200_OK)

    def test_creating_a_slot_returns_the_conflict_list_in_meta(self) -> None:
        self.allow("timetable.slot.create", "timetable.slot.view")

        response = self.client.post("/api/v1/timetable-slots", self._payload(), format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        body = response.json()
        self.assertEqual(body["meta"]["conflicts"], [])
        self.assertEqual(body["data"]["status"], SlotStatus.DRAFT)

    def test_a_hard_conflict_still_saves_and_is_reported(self) -> None:
        """§5.5: hard conflicts block *publish*, not save — a grid mid-build must persist."""
        self.allow("timetable.slot.create", "timetable.slot.view")
        self.make_slot()

        response = self.client.post("/api/v1/timetable-slots", self._payload(), format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        types = {conflict["type"] for conflict in response.json()["meta"]["conflicts"]}
        self.assertIn("section_double_booked", types)
        with tenant_context(self.tenant.id):
            self.assertEqual(TimetableSlot.objects.alive().count(), 2)

    def test_a_teacher_without_an_allocation_is_a_reported_conflict_not_a_refusal(self) -> None:
        self.allow("timetable.slot.create")
        with tenant_context(self.tenant.id):
            stranger = StaffFactory(tenant=self.tenant, campus=self.campus)

        response = self.client.post(
            "/api/v1/timetable-slots", self._payload(staff_id=str(stranger.pk)), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        types = {conflict["type"] for conflict in response.json()["meta"]["conflicts"]}
        self.assertIn("teacher_not_allocated", types)

    def test_non_teaching_staff_cannot_hold_a_period(self) -> None:
        """§11 — a validation error, unlike the allocation rule above."""
        self.allow("timetable.slot.create")
        with tenant_context(self.tenant.id):
            admin_staff = StaffFactory(
                tenant=self.tenant, campus=self.campus, staff_type=StaffType.NON_TEACHING
            )

        response = self.client.post(
            "/api/v1/timetable-slots", self._payload(staff_id=str(admin_staff.pk)), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_an_exited_teacher_cannot_hold_a_period(self) -> None:
        self.allow("timetable.slot.create")
        with tenant_context(self.tenant.id):
            self.teacher.employment_status = EmploymentStatus.RESIGNED
            self.teacher.save(update_fields=["employment_status"])

        response = self.client.post("/api/v1/timetable-slots", self._payload(), format="json")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_a_weekday_outside_zero_to_six_is_a_field_error(self) -> None:
        self.allow("timetable.slot.create")

        response = self.client.post(
            "/api/v1/timetable-slots", self._payload(day_of_week=9), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        fields = {detail["field"] for detail in response.json()["error"]["details"]}
        self.assertIn("day_of_week", fields)

    def test_a_homeroom_slot_needs_neither_subject_nor_teacher(self) -> None:
        """The grid is not only teaching periods (models.py)."""
        self.allow("timetable.slot.create")

        response = self.client.post(
            "/api/v1/timetable-slots",
            self._payload(subject_id=None, staff_id=None, room_id=None),
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())

    def test_status_is_read_only_on_create(self) -> None:
        """A client must not be able to publish by writing the field."""
        self.allow("timetable.slot.create")

        response = self.client.post(
            "/api/v1/timetable-slots",
            self._payload(status=SlotStatus.PUBLISHED),
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        self.assertEqual(response.json()["data"]["status"], SlotStatus.DRAFT)

    def test_patching_a_slot_returns_conflicts_too(self) -> None:
        self.allow("timetable.slot.update", "timetable.slot.view")
        slot = self.make_slot()

        response = self.client.patch(
            f"/api/v1/timetable-slots/{slot.pk}", {"notes": "double period"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["notes"], "double period")
        self.assertEqual(response.json()["meta"]["conflicts"], [])

    def test_a_published_slot_cannot_be_edited_in_place(self) -> None:
        """§5.7 — republish instead, so the change carries validation and notice."""
        self.allow("timetable.slot.update")
        slot = self.publish(self.make_slot())

        response = self.client.patch(
            f"/api/v1/timetable-slots/{slot.pk}", {"notes": "sneaky"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_deleting_a_slot_returns_the_remaining_conflicts(self) -> None:
        """200 with a body, not 204: §16 wants `meta.conflicts` on every mutation."""
        self.allow("timetable.slot.delete", "timetable.slot.view")
        first = self.make_slot()
        self.make_slot()

        response = self.client.delete(f"/api/v1/timetable-slots/{first.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertIsNone(response.json()["data"])
        self.assertEqual(response.json()["meta"]["conflicts"], [])
        with tenant_context(self.tenant.id):
            self.assertFalse(TimetableSlot.objects.alive().filter(pk=first.pk).exists())

    def test_a_published_slot_cannot_be_deleted(self) -> None:
        self.allow("timetable.slot.delete")
        slot = self.publish(self.make_slot())

        response = self.client.delete(f"/api/v1/timetable-slots/{slot.pk}")

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_the_list_is_cursor_paginated(self) -> None:
        """§16 says cursor, and the client contract is `?cursor=<token>`."""
        self.allow("timetable.slot.view")
        for sequence, period in enumerate(self.periods):
            self.make_slot(period=period, day_of_week=sequence % 5)

        first = self.client.get("/api/v1/timetable-slots?page_size=2").json()

        pagination = first["meta"]["pagination"]
        self.assertEqual(set(pagination), {"next_cursor", "previous_cursor", "page_size"})
        self.assertIsNotNone(pagination["next_cursor"])
        self.assertNotIn("://", pagination["next_cursor"])

    def test_slots_filter_on_every_field_section_sixteen_names(self) -> None:
        self.allow("timetable.slot.view")
        mine = self.make_slot()
        with tenant_context(self.tenant.id):
            stranger = StaffFactory(tenant=self.tenant, campus=self.campus)
            other_room = RoomFactory(tenant=self.tenant, campus=self.campus)
        self.make_slot(
            section=self.other_section,
            period=self.periods[1],
            day_of_week=3,
            staff=stranger,
            room=other_room,
        )

        for query in (
            f"section_id={self.section.pk}",
            f"teacher_id={self.teacher.pk}",
            f"room_id={self.room.pk}",
            "weekday=0",
            "status=draft&weekday=0",
            f"academic_session_id={self.session.pk}&weekday=0",
        ):
            with self.subTest(query=query):
                rows = self.client.get(f"/api/v1/timetable-slots?{query}").json()["data"]
                self.assertEqual([row["id"] for row in rows], [str(mine.pk)])

    def test_the_status_filter_separates_drafts_from_published(self) -> None:
        self.allow("timetable.slot.view")
        draft = self.make_slot()
        published = self.publish(self.make_slot(period=self.periods[1]))

        drafts = self.client.get("/api/v1/timetable-slots?status=draft").json()["data"]
        live = self.client.get("/api/v1/timetable-slots?status=published").json()["data"]

        self.assertEqual([row["id"] for row in drafts], [str(draft.pk)])
        self.assertEqual([row["id"] for row in live], [str(published.pk)])


class ValidateAndPublishTests(TimetableAPITestCase):
    def test_validate_reports_a_clean_grid(self) -> None:
        self.allow("timetable.slot.view")
        self.make_slot()

        response = self.client.post(
            f"/api/v1/timetables/{self.section.pk}:validate", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        body = response.json()["data"]
        self.assertEqual(body["conflicts"], [])
        self.assertFalse(body["has_hard_conflicts"])
        self.assertEqual(body["academic_session_id"], str(self.session.pk))

    def test_validate_lists_every_hard_conflict_at_once(self) -> None:
        """§6: a client highlights cells, so the run reports all of them, not the first."""
        self.allow("timetable.slot.view")
        self.make_slot()
        self.make_slot()

        response = self.client.post(
            f"/api/v1/timetables/{self.section.pk}:validate", {}, format="json"
        )

        conflicts = response.json()["data"]["conflicts"]
        self.assertTrue(response.json()["data"]["has_hard_conflicts"])
        self.assertIn("section_double_booked", {c["type"] for c in conflicts})
        self.assertTrue(all(len(c["slot_ids"]) >= 1 for c in conflicts))

    def test_validate_takes_an_explicit_session(self) -> None:
        self.allow("timetable.slot.view")
        self.make_slot()

        response = self.client.post(
            f"/api/v1/timetables/{self.section.pk}:validate",
            {"academic_session_id": str(self.session.pk)},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

    def test_publishing_needs_the_publish_key(self) -> None:
        self.allow("timetable.slot.view", "timetable.slot.create")
        self.make_slot()

        response = self.client.post(
            f"/api/v1/timetables/{self.section.pk}:publish", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_publishing_promotes_the_draft(self) -> None:
        self.allow("timetable.timetable.publish")
        slot = self.make_slot()

        response = self.client.post(
            f"/api/v1/timetables/{self.section.pk}:publish", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["published"], 1)
        with tenant_context(self.tenant.id):
            slot.refresh_from_db()
        self.assertEqual(slot.status, SlotStatus.PUBLISHED)
        self.assertIsNotNone(slot.effective_from)

    def test_a_hard_conflict_blocks_publish_with_422(self) -> None:
        self.allow("timetable.timetable.publish")
        self.make_slot()
        self.make_slot()

        response = self.client.post(
            f"/api/v1/timetables/{self.section.pk}:publish", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        with tenant_context(self.tenant.id):
            self.assertEqual(
                TimetableSlot.objects.alive().filter(status=SlotStatus.PUBLISHED).count(), 0
            )

    def test_a_refused_publish_returns_the_findings_as_structured_meta(self) -> None:
        """The list is the point of the refusal — the grid highlights exactly
        these cells, so it must arrive shaped rather than flattened.

        `error.details` is a flat `{field, issue}` list and the handler walks any
        nested value into it one leaf at a time, which turned `slot_ids` into one
        entry per id; a client keeping the first issue per field name would
        highlight one side of a double booking and not the other. `error.meta`
        is passed through as JSON.
        """
        self.allow("timetable.timetable.publish")
        first = self.make_slot()
        second = self.make_slot()

        response = self.client.post(
            f"/api/v1/timetables/{self.section.pk}:publish", {}, format="json"
        )

        error = response.json()["error"]
        self.assertNotIn(
            "conflicts",
            {row["field"].split(".")[0].split("[")[0] for row in error["details"]},
            "the findings must not be flattened into details",
        )
        conflicts = error["meta"]["conflicts"]
        clash = next(c for c in conflicts if c["type"] == "section_double_booked")
        self.assertEqual(clash["severity"], "hard")
        self.assertEqual(
            sorted(clash["slot_ids"]),
            sorted([str(first.pk), str(second.pk)]),
            "both sides of the clash are named, not just the row saved second",
        )

    def test_a_publish_refused_for_a_non_conflict_reason_carries_no_meta(self) -> None:
        """`meta` is present only when there is structured context. "There is no
        draft to publish" is a sentence, not a list of cells."""
        self.allow("timetable.timetable.publish")

        response = self.client.post(
            f"/api/v1/timetables/{self.section.pk}:publish", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertNotIn("meta", response.json()["error"])

    def test_a_soft_conflict_does_not_block_publish(self) -> None:
        """§5.5 — a room one seat short is a warning, not a reason to block a school."""
        self.allow("timetable.timetable.publish")
        with tenant_context(self.tenant.id):
            self.room.capacity = 1
            self.room.save(update_fields=["capacity"])
            student = StudentFactory(tenant=self.tenant, campus=self.campus)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=student,
                academic_session=self.session,
                school_class=self.school_class,
                section=self.section,
            )
            other = StudentFactory(tenant=self.tenant, campus=self.campus)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=other,
                academic_session=self.session,
                school_class=self.school_class,
                section=self.section,
            )
        self.make_slot()

        response = self.client.post(
            f"/api/v1/timetables/{self.section.pk}:publish", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        types = {c["type"] for c in response.json()["data"]["conflicts"]}
        self.assertIn("room_over_capacity", types)

    def test_publishing_with_no_draft_is_refused(self) -> None:
        self.allow("timetable.timetable.publish")

        response = self.client.post(
            f"/api/v1/timetables/{self.section.pk}:publish", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_republishing_supersedes_rather_than_replaces(self) -> None:
        """§7.1 — history of what was in force when is what attendance reconciles against."""
        self.allow("timetable.timetable.publish")
        first = self.make_slot()
        self.client.post(f"/api/v1/timetables/{self.section.pk}:publish", {}, format="json")
        self.make_slot(period=self.periods[1])

        response = self.client.post(
            f"/api/v1/timetables/{self.section.pk}:publish", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["superseded"], 1)
        with tenant_context(self.tenant.id):
            first.refresh_from_db()
        self.assertIsNotNone(first.effective_to, "the outgoing version should be end-dated")

    def test_publishing_into_a_closed_session_is_refused(self) -> None:
        """§11: publishing requires an active session."""
        self.allow("timetable.timetable.publish")
        self.make_slot()
        with tenant_context(self.tenant.id):
            self.session.status = SessionStatus.CLOSED
            self.session.save(update_fields=["status"])

        response = self.client.post(
            f"/api/v1/timetables/{self.section.pk}:publish", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_acting_on_an_unknown_section_is_404(self) -> None:
        self.allow_everything()
        stray = self.tenant.pk  # a real UUID that is not a section id

        for verb in ("validate", "publish"):
            with self.subTest(verb=verb):
                response = self.client.post(f"/api/v1/timetables/{stray}:{verb}", {}, format="json")
                self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_missing_current_session_is_a_field_error_not_a_crash(self) -> None:
        self.allow("timetable.slot.view")
        with tenant_context(self.tenant.id):
            self.session.is_current = False
            self.session.save(update_fields=["is_current"])

        response = self.client.post(
            f"/api/v1/timetables/{self.section.pk}:validate", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        fields = {detail["field"] for detail in response.json()["error"]["details"]}
        self.assertIn("academic_session_id", fields)


class MyTimetableTests(TimetableAPITestCase):
    """`GET /timetables/my` — the module's only endpoint a learner reaches."""

    def _teacher_client(self, staff):
        user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            staff.user_id = user.pk
            staff.save(update_fields=["user_id"])
        grant(user, "timetable.timetable.view")
        authenticate(self.client, user)
        return user

    def _enrolled_student(self, section=None):
        with tenant_context(self.tenant.id):
            student = StudentFactory(tenant=self.tenant, campus=self.campus)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=student,
                academic_session=self.session,
                school_class=self.school_class,
                section=section or self.section,
            )
        return student

    def test_a_teacher_sees_only_the_periods_they_hold(self) -> None:
        with tenant_context(self.tenant.id):
            colleague = StaffFactory(tenant=self.tenant, campus=self.campus)
            # Not primary: the base fixture's allocation already holds that for
            # this (section, subject), and `tsa_one_primary_per_section_subject`
            # allows exactly one. A colleague sharing the cell is a secondary.
            TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=self.section,
                subject=self.subject,
                staff=colleague,
                is_primary=False,
            )
        mine = self.publish(self.make_slot())
        self.publish(self.make_slot(period=self.periods[1], staff=colleague))
        self._teacher_client(self.teacher)

        response = self.client.get("/api/v1/timetables/my")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        body = response.json()
        self.assertEqual([row["id"] for row in body["data"]], [str(mine.pk)])
        self.assertEqual(body["meta"]["audience"], "teacher")

    def test_the_response_inlines_what_a_phone_needs_to_render_a_cell(self) -> None:
        self.publish(self.make_slot())
        self._teacher_client(self.teacher)

        row = self.client.get("/api/v1/timetables/my").json()["data"][0]

        self.assertEqual(row["period_name"], self.period.name)
        self.assertEqual(row["subject_name"], self.subject.name)
        self.assertEqual(row["section_name"], self.section.name)
        self.assertEqual(row["room_name"], self.room.name)
        self.assertIsNone(row["substitution"])

    def test_drafts_never_reach_the_personal_timetable(self) -> None:
        """§5.7 — the whole point of drafting privately."""
        self.make_slot()
        self._teacher_client(self.teacher)

        response = self.client.get("/api/v1/timetables/my")

        self.assertEqual(response.json()["data"], [])

    def test_a_student_sees_their_own_sections_published_grid(self) -> None:
        slot = self.publish(self.make_slot())
        student = self._enrolled_student()
        user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            student.user_id = user.pk
            student.save(update_fields=["user_id"])
        grant(user, "timetable.timetable.view", is_restricted_principal=True)
        authenticate(self.client, user)

        response = self.client.get("/api/v1/timetables/my")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual([row["id"] for row in response.json()["data"]], [str(slot.pk)])
        self.assertEqual(response.json()["meta"]["audience"], "learner")

    def test_a_guardian_sees_their_child_grid(self) -> None:
        """The `student_guardians` join, honouring `has_portal_access`."""
        slot = self.publish(self.make_slot())
        student = self._enrolled_student()
        user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            guardian = GuardianFactory(tenant=self.tenant, user_id=user.pk)
            StudentGuardianFactory(tenant=self.tenant, student=student, guardian=guardian)
        grant(user, "timetable.timetable.view", is_restricted_principal=True)
        authenticate(self.client, user)

        response = self.client.get("/api/v1/timetables/my")

        self.assertEqual([row["id"] for row in response.json()["data"]], [str(slot.pk)])

    def test_a_guardian_whose_portal_access_was_revoked_sees_nothing(self) -> None:
        self.publish(self.make_slot())
        student = self._enrolled_student()
        user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            guardian = GuardianFactory(tenant=self.tenant, user_id=user.pk)
            StudentGuardianFactory(
                tenant=self.tenant,
                student=student,
                guardian=guardian,
                has_portal_access=False,
            )
        grant(user, "timetable.timetable.view", is_restricted_principal=True)
        authenticate(self.client, user)

        self.assertEqual(self.client.get("/api/v1/timetables/my").json()["data"], [])

    def test_a_guardian_sees_nothing_of_a_child_they_are_not_linked_to(self) -> None:
        self.publish(self.make_slot())
        self._enrolled_student()
        user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            GuardianFactory(tenant=self.tenant, user_id=user.pk)
        grant(user, "timetable.timetable.view", is_restricted_principal=True)
        authenticate(self.client, user)

        self.assertEqual(self.client.get("/api/v1/timetables/my").json()["data"], [])

    def test_a_withdrawn_enrollment_no_longer_shows_a_timetable(self) -> None:
        self.publish(self.make_slot())
        student = self._enrolled_student()
        user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            student.user_id = user.pk
            student.save(update_fields=["user_id"])
            enrollment = student.enrollments.get()
            enrollment.status = EnrollmentStatus.WITHDRAWN
            enrollment.save(update_fields=["status"])
        grant(user, "timetable.timetable.view", is_restricted_principal=True)
        authenticate(self.client, user)

        self.assertEqual(self.client.get("/api/v1/timetables/my").json()["data"], [])

    def test_a_date_applies_a_confirmed_substitution(self) -> None:
        slot = self.publish(self.make_slot())
        with tenant_context(self.tenant.id):
            cover = StaffFactory(tenant=self.tenant, campus=self.campus)
            TeacherSubstitutionFactory(
                tenant=self.tenant,
                timetable_slot=slot,
                date=MONDAY,
                absent_staff=self.teacher,
                substitute_staff=cover,
                status=SubstitutionStatus.CONFIRMED,
            )
        self._teacher_client(self.teacher)

        row = self.client.get(f"/api/v1/timetables/my?date={MONDAY.isoformat()}").json()["data"][0]

        self.assertEqual(row["id"], str(slot.pk))
        self.assertEqual(row["substitution"]["substitute_staff_id"], str(cover.pk))

    def test_without_a_date_the_base_grid_comes_back_unsubstituted(self) -> None:
        """§7.2 — a substitution overrides specific dates only."""
        slot = self.publish(self.make_slot())
        with tenant_context(self.tenant.id):
            cover = StaffFactory(tenant=self.tenant, campus=self.campus)
            TeacherSubstitutionFactory(
                tenant=self.tenant,
                timetable_slot=slot,
                date=MONDAY,
                absent_staff=self.teacher,
                substitute_staff=cover,
                status=SubstitutionStatus.CONFIRMED,
            )
        self._teacher_client(self.teacher)

        row = self.client.get("/api/v1/timetables/my").json()["data"][0]

        self.assertIsNone(row["substitution"])

    def test_a_proposed_substitution_is_not_applied(self) -> None:
        """Only a confirmed cover changes what happens in the room."""
        slot = self.publish(self.make_slot())
        with tenant_context(self.tenant.id):
            cover = StaffFactory(tenant=self.tenant, campus=self.campus)
            TeacherSubstitutionFactory(
                tenant=self.tenant,
                timetable_slot=slot,
                date=MONDAY,
                absent_staff=self.teacher,
                substitute_staff=cover,
            )
        self._teacher_client(self.teacher)

        row = self.client.get(f"/api/v1/timetables/my?date={MONDAY.isoformat()}").json()["data"][0]

        self.assertIsNone(row["substitution"])

    def test_a_covering_teacher_sees_a_section_they_never_teach(self) -> None:
        """The cover set is why `_teacher_timetable` needs a second query."""
        with tenant_context(self.tenant.id):
            stranger = StaffFactory(tenant=self.tenant, campus=self.campus)
            TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=self.other_section,
                subject=self.subject,
                staff=stranger,
            )
        slot = self.publish(self.make_slot(section=self.other_section, staff=stranger))
        with tenant_context(self.tenant.id):
            TeacherSubstitutionFactory(
                tenant=self.tenant,
                timetable_slot=slot,
                date=MONDAY,
                absent_staff=stranger,
                substitute_staff=self.teacher,
                status=SubstitutionStatus.CONFIRMED,
            )
        self._teacher_client(self.teacher)

        rows = self.client.get(f"/api/v1/timetables/my?date={MONDAY.isoformat()}").json()["data"]

        self.assertEqual([row["id"] for row in rows], [str(slot.pk)])

    def test_a_malformed_date_is_a_field_error_not_a_crash(self) -> None:
        self._teacher_client(self.teacher)

        response = self.client.get("/api/v1/timetables/my?date=not-a-date")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        fields = {detail["field"] for detail in response.json()["error"]["details"]}
        self.assertIn("date", fields)

    def test_an_explicit_session_is_honoured(self) -> None:
        self.publish(self.make_slot())
        with tenant_context(self.tenant.id):
            other_session = AcademicSessionFactory(
                tenant=self.tenant,
                start_date=datetime.date(2028, 4, 1),
                end_date=datetime.date(2029, 3, 31),
            )
        self._teacher_client(self.teacher)

        rows = self.client.get(
            f"/api/v1/timetables/my?academic_session_id={other_session.pk}"
        ).json()["data"]

        self.assertEqual(rows, [], "a different session has no slots")

    def test_the_endpoint_still_requires_the_view_key(self) -> None:
        """Reachable by learners is not the same as reachable by anyone."""
        self.publish(self.make_slot())
        user = UserFactory(tenant=self.tenant)
        authenticate(self.client, user)

        self.assertEqual(
            self.client.get("/api/v1/timetables/my").status_code, status.HTTP_403_FORBIDDEN
        )

    def test_restricted_principals_are_refused_every_other_endpoint(self) -> None:
        """The mirror of the test above: `/my` is the only door they have."""
        user = UserFactory(tenant=self.tenant)
        grant(
            user,
            "timetable.timetable.view",
            "timetable.slot.view",
            is_restricted_principal=True,
        )
        authenticate(self.client, user)

        for path in ("/api/v1/rooms", "/api/v1/periods", "/api/v1/timetable-slots"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, status.HTTP_403_FORBIDDEN)

    def test_the_module_flag_gates_the_personal_timetable_too(self) -> None:
        self.publish(self.make_slot())
        self._teacher_client(self.teacher)
        with tenant_context(self.tenant.id):
            override = TenantFeatureOverride.objects.get(
                tenant=self.tenant, feature_flag__key="module.timetable"
            )
            override.enabled = False
            override.save(update_fields=["enabled"])

        response = self.client.get("/api/v1/timetables/my")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.json()["error"]["code"], "module_disabled")


class FeatureFlagTests(TimetableAPITestCase):
    def test_every_list_is_refused_while_the_module_is_off(self) -> None:
        """Phase-2 rule 5: every module ships behind a flag, default off."""
        self.allow_everything()
        with tenant_context(self.tenant.id):
            override = TenantFeatureOverride.objects.get(
                tenant=self.tenant, feature_flag__key="module.timetable"
            )
            override.enabled = False
            override.save(update_fields=["enabled"])

        for path in (
            "/api/v1/rooms",
            "/api/v1/periods",
            "/api/v1/timetable-slots",
            "/api/v1/teacher-substitutions",
        ):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
                self.assertEqual(response.json()["error"]["code"], "module_disabled")


class SubjectlessGridTests(TimetableAPITestCase):
    def test_a_subject_not_in_the_curriculum_is_still_schedulable_as_a_conflict(self) -> None:
        """Timetable does not re-police academics' curriculum; the engine reports it."""
        self.allow("timetable.slot.create")
        with tenant_context(self.tenant.id):
            unrelated = SubjectFactory(tenant=self.tenant)

        response = self.client.post(
            "/api/v1/timetable-slots",
            {
                "academic_session_id": str(self.session.pk),
                "section_id": str(self.section.pk),
                "day_of_week": 0,
                "period_id": str(self.period.pk),
                "subject_id": str(unrelated.pk),
                "staff_id": str(self.teacher.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        types = {c["type"] for c in response.json()["meta"]["conflicts"]}
        self.assertIn("teacher_not_allocated", types)


class EffectiveVersionTests(TimetableAPITestCase):
    """`GET /timetables/my?date=` must answer with the version in force *then*.

    `publish_section_timetable` supersedes by end-dating rather than deleting,
    explicitly so a past date can be read back as it actually was — attendance
    and examinations are reconciled against what was live at the time. A read
    that only ever took `effective_to IS NULL` stored that history and never used
    it: last month's query answered with today's grid.

    The window is half-open, `[effective_from, effective_to)`, because publish
    stamps the outgoing rows' end and the incoming rows' start with the same day.
    """

    def setUp(self) -> None:
        super().setUp()
        self.changeover = datetime.date(2026, 10, 1)
        self.old_slot = self.make_slot()
        with tenant_context(self.tenant.id):
            self.new_room = RoomFactory(tenant=self.tenant, campus=self.campus, capacity=40)
            TimetableSlot.objects.alive().filter(pk=self.old_slot.pk).update(
                status=SlotStatus.PUBLISHED,
                effective_from=self.session.start_date,
                effective_to=self.changeover,
            )
        self.new_slot = self.make_slot(room=self.new_room)
        with tenant_context(self.tenant.id):
            TimetableSlot.objects.alive().filter(pk=self.new_slot.pk).update(
                status=SlotStatus.PUBLISHED, effective_from=self.changeover
            )
        self._as_teacher()

    def _as_teacher(self) -> None:
        user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            self.teacher.user_id = user.pk
            self.teacher.save(update_fields=["user_id"])
        grant(user, "timetable.timetable.view")
        authenticate(self.client, user)

    def ids_on(self, on_date) -> list[str]:
        response = self.client.get(f"/api/v1/timetables/my?date={on_date.isoformat()}")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return [row["id"] for row in response.json()["data"]]

    def test_a_date_before_the_changeover_returns_the_superseded_version(self) -> None:
        before = self.changeover - datetime.timedelta(days=7)

        self.assertEqual(self.ids_on(before), [str(self.old_slot.pk)])

    def test_the_changeover_day_itself_belongs_to_the_new_version(self) -> None:
        """Both rows carry that date — one as its end, one as its start. An
        inclusive upper bound would return the cell twice."""
        self.assertEqual(self.ids_on(self.changeover), [str(self.new_slot.pk)])

    def test_a_date_after_the_changeover_returns_the_current_version(self) -> None:
        after = self.changeover + datetime.timedelta(days=7)

        self.assertEqual(self.ids_on(after), [str(self.new_slot.pk)])

    def test_without_a_date_the_answer_is_the_current_grid(self) -> None:
        """No date means no version to choose, so the base grid is the answer —
        the superseded row must not leak into it."""
        response = self.client.get("/api/v1/timetables/my")

        self.assertEqual([row["id"] for row in response.json()["data"]], [str(self.new_slot.pk)])
