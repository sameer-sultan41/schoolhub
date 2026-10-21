"""Releasing cover (`:cancel`), finding who can give it (`candidates`), and covering a slot
again after a reject or a cancel (timetable.md §7.2)."""

from __future__ import annotations

import datetime

from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status

from apps.attendance.models import (
    LeaveAppliesTo,
    LeaveRequest,
    LeaveStatus,
    LeaveType,
    RequesterType,
    StaffAttendance,
    StaffAttendanceStatus,
)
from apps.staff_management.models import EmploymentStatus
from apps.timetable import notifications
from apps.timetable.models import SubstitutionStatus, TeacherSubstitution
from apps.timetable.substitutions import services
from apps.timetable.tests.base import TimetableAPITestCase
from apps.timetable.tests.factories import (
    MONDAY,
    CampusFactory,
    StaffFactory,
    TeacherSubstitutionFactory,
    UserFactory,
    authenticate,
    grant,
)
from core.audit.models import AuditLog
from core.notifications.models import Notification
from core.tenancy.context import tenant_context


def next_monday() -> datetime.date:
    """A Monday after today; `CoverTestCase` keeps the session open past it."""
    today = timezone.localdate()
    return today + datetime.timedelta(days=7 - today.weekday())


class CoverTestCase(TimetableAPITestCase):
    """A published Monday slot taught by `self.teacher`, and a free colleague, `self.cover`."""

    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            # The fixture session has fixed dates; cover "after today" must still fall in it.
            later = next_monday() + datetime.timedelta(weeks=12)
            if self.session.end_date < later:
                self.session.end_date = later
                self.session.save(update_fields=["end_date"])
        self.slot = self.publish(self.make_slot())
        with tenant_context(self.tenant.id):
            self.cover = StaffFactory(
                tenant=self.tenant,
                campus=self.campus,
                last_name="Baker",
                user_id=UserFactory(tenant=self.tenant).pk,
            )

    def open_cover(self, *, on: datetime.date, created_by=None, **overrides):
        fields = {
            "tenant": self.tenant,
            "timetable_slot": self.slot,
            "date": on,
            "absent_staff": self.teacher,
            "substitute_staff": self.cover,
            "created_by": created_by,
        }
        fields.update(overrides)
        with tenant_context(self.tenant.id):
            return TeacherSubstitutionFactory(**fields)

    def status_of(self, substitution) -> str:
        with tenant_context(self.tenant.id):
            return TeacherSubstitution.objects.get(pk=substitution.pk).status

    def cancel(self, substitution):
        return self.client.post(
            f"/api/v1/teacher-substitutions/{substitution.pk}:cancel", {}, format="json"
        )


class CancelTests(CoverTestCase):
    def test_an_approver_cancels_confirmed_cover(self) -> None:
        self.allow("timetable.timetable.view", "timetable.substitution.approve")
        cover = self.open_cover(on=next_monday(), status=SubstitutionStatus.CONFIRMED)

        response = self.cancel(cover)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["status"], SubstitutionStatus.CANCELLED)

    def test_a_proposer_withdraws_their_own_proposal(self) -> None:
        self.allow("timetable.timetable.view", "timetable.substitution.create")
        cover = self.open_cover(on=next_monday(), created_by=self.user.pk)

        response = self.cancel(cover)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(self.status_of(cover), SubstitutionStatus.CANCELLED)

    def test_a_proposer_cannot_cancel_cover_once_it_is_confirmed(self) -> None:
        self.allow("timetable.timetable.view", "timetable.substitution.create")
        cover = self.open_cover(
            on=next_monday(), created_by=self.user.pk, status=SubstitutionStatus.CONFIRMED
        )

        self.assertEqual(self.cancel(cover).status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(self.status_of(cover), SubstitutionStatus.CONFIRMED)

    def test_a_proposer_cannot_cancel_someone_elses_proposal(self) -> None:
        self.allow("timetable.timetable.view", "timetable.substitution.create")
        other = UserFactory(tenant=self.tenant)
        cover = self.open_cover(on=next_monday(), created_by=other.pk)

        self.assertEqual(self.cancel(cover).status_code, status.HTTP_403_FORBIDDEN)

    def test_a_viewer_with_neither_key_is_refused(self) -> None:
        self.allow("timetable.timetable.view")
        cover = self.open_cover(on=next_monday(), created_by=self.user.pk)

        self.assertEqual(self.cancel(cover).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.status_of(cover), SubstitutionStatus.PROPOSED)

    def test_past_cover_cannot_be_cancelled(self) -> None:
        self.allow("timetable.timetable.view", "timetable.substitution.approve")
        cover = self.open_cover(on=MONDAY, status=SubstitutionStatus.CONFIRMED)

        response = self.cancel(cover)

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(self.status_of(cover), SubstitutionStatus.CONFIRMED)

    def test_the_substitute_is_told(self) -> None:
        self.allow("timetable.timetable.view", "timetable.substitution.approve")
        cover = self.open_cover(on=next_monday(), status=SubstitutionStatus.CONFIRMED)

        self.cancel(cover)

        with tenant_context(self.tenant.id):
            notification = Notification.objects.get(user_id=self.cover.user_id)
        self.assertEqual(notification.event_key, notifications.SUBSTITUTION_CANCELLED)
        self.assertEqual(notification.source_id, cover.pk)

    def test_it_is_audited(self) -> None:
        self.allow("timetable.timetable.view", "timetable.substitution.approve")
        cover = self.open_cover(on=next_monday())

        self.cancel(cover)

        with tenant_context(self.tenant.id):
            entry = AuditLog.objects.get(action="cancel", resource_id=cover.pk)
        self.assertEqual(entry.before["status"], SubstitutionStatus.PROPOSED)
        self.assertEqual(entry.after["status"], SubstitutionStatus.CANCELLED)

    def test_a_second_cancel_is_a_conflict(self) -> None:
        self.allow("timetable.timetable.view", "timetable.substitution.approve")
        cover = self.open_cover(on=next_monday())

        self.cancel(cover)

        self.assertEqual(self.cancel(cover).status_code, status.HTTP_409_CONFLICT)


class CoverAgainTests(CoverTestCase):
    """A declined or cancelled cover holds nothing: the slot can be covered again that day."""

    def setUp(self) -> None:
        super().setUp()
        self.allow("timetable.timetable.view", "timetable.substitution.create")
        with tenant_context(self.tenant.id):
            self.second = StaffFactory(tenant=self.tenant, campus=self.campus)

    def propose_second(self, on: datetime.date):
        return self.client.post(
            "/api/v1/teacher-substitutions",
            {
                "timetable_slot_id": str(self.slot.pk),
                "date": on.isoformat(),
                "absent_staff_id": str(self.teacher.pk),
                "substitute_staff_id": str(self.second.pk),
            },
            format="json",
        )

    def test_after_a_reject(self) -> None:
        self.open_cover(on=MONDAY, status=SubstitutionStatus.DECLINED)

        response = self.propose_second(MONDAY)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())

    def test_after_a_cancel(self) -> None:
        self.open_cover(on=next_monday(), status=SubstitutionStatus.CANCELLED)

        response = self.propose_second(next_monday())

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())

    def test_not_by_a_teacher_from_another_campus(self) -> None:
        with tenant_context(self.tenant.id):
            self.second = StaffFactory(tenant=self.tenant, campus=CampusFactory(tenant=self.tenant))

        response = self.propose_second(MONDAY)

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("substitute_staff_id", str(response.json()))

    def test_not_while_cover_is_still_open(self) -> None:
        self.open_cover(on=MONDAY)

        self.assertNotEqual(self.propose_second(MONDAY).status_code, status.HTTP_201_CREATED)

    def test_the_automatic_proposal_covers_a_slot_whose_cover_was_declined(self) -> None:
        self.open_cover(on=MONDAY, status=SubstitutionStatus.DECLINED)

        with tenant_context(self.tenant.id):
            proposed = services.propose_substitutions_for_absence(
                staff=self.teacher, on_date=MONDAY, actor_id=self.user.pk
            )

        self.assertEqual(len(proposed), 1)


class CandidatesTests(CoverTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow("timetable.timetable.view", "timetable.substitution.create")

    def candidates(self, *, on: datetime.date = MONDAY, slot=None):
        return self.client.get(
            "/api/v1/teacher-substitutions/candidates",
            {"timetable_slot_id": str((slot or self.slot).pk), "date": on.isoformat()},
        )

    def names(self, **kwargs) -> list[str]:
        response = self.candidates(**kwargs)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return [row["staff_name"] for row in response.json()["data"]]

    def test_a_free_colleague_is_offered_and_the_absent_teacher_is_not(self) -> None:
        names = self.names()

        self.assertIn(self.cover.full_name, names)
        self.assertNotIn(self.teacher.full_name, names)

    def test_each_kind_of_busy_or_away_teacher_is_left_out(self) -> None:
        with tenant_context(self.tenant.id):
            teaching = StaffFactory(tenant=self.tenant, campus=self.campus)
            covering = StaffFactory(tenant=self.tenant, campus=self.campus)
            elsewhere = StaffFactory(tenant=self.tenant, campus=CampusFactory(tenant=self.tenant))
            inactive = StaffFactory(
                tenant=self.tenant, campus=self.campus, employment_status=EmploymentStatus.RESIGNED
            )
            on_leave = StaffFactory(tenant=self.tenant, campus=self.campus)
            marked_absent = StaffFactory(tenant=self.tenant, campus=self.campus)
            leave_type = LeaveType.objects.create(
                tenant=self.tenant, name="Sick", code="SICK", applies_to=LeaveAppliesTo.STAFF
            )
            LeaveRequest.objects.create(
                tenant=self.tenant,
                requester_type=RequesterType.STAFF,
                staff=on_leave,
                leave_type=leave_type,
                start_date=MONDAY,
                end_date=MONDAY,
                days_count=1,
                reason="Unwell.",
                submitted_by=self.user.pk,
                status=LeaveStatus.APPROVED,
            )
            StaffAttendance.objects.create(
                tenant=self.tenant,
                staff=marked_absent,
                attendance_date=MONDAY,
                status=StaffAttendanceStatus.ABSENT,
                marked_by=self.user.pk,
            )
        # `teaching` has its own class in the slot's period; `covering` is covering that
        # class the same Monday, so both are busy then.
        other_class = self.publish(self.make_slot(section=self.other_section, staff=teaching))
        with tenant_context(self.tenant.id):
            TeacherSubstitutionFactory(
                tenant=self.tenant,
                timetable_slot=other_class,
                date=MONDAY,
                absent_staff=teaching,
                substitute_staff=covering,
            )

        names = self.names()

        for left_out in (teaching, covering, elsewhere, inactive, on_leave, marked_absent):
            with self.subTest(name=left_out.full_name):
                self.assertNotIn(left_out.full_name, names)
        self.assertIn(self.cover.full_name, names)

    def test_a_teacher_already_covering_that_period_is_left_out(self) -> None:
        self.open_cover(on=MONDAY)

        self.assertNotIn(self.cover.full_name, self.names())

    def test_the_automatic_proposal_picks_the_first_candidate(self) -> None:
        with tenant_context(self.tenant.id):
            first = (
                services.free_substitutes(slot=self.slot, on_date=MONDAY, absent_staff=self.teacher)
                .order_by("pk")
                .first()
            )
            proposed = services.propose_substitutions_for_absence(
                staff=self.teacher, on_date=MONDAY, actor_id=self.user.pk
            )

        self.assertEqual([cover.substitute_staff_id for cover in proposed], [first.pk])

    def test_a_draft_slot_or_the_wrong_weekday_is_refused(self) -> None:
        draft = self.make_slot(period=self.periods[1])

        self.assertEqual(
            self.candidates(slot=draft).status_code, status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        self.assertEqual(
            self.candidates(on=MONDAY + datetime.timedelta(days=1)).status_code,
            status.HTTP_422_UNPROCESSABLE_ENTITY,
        )

    def test_a_date_outside_the_session_is_refused(self) -> None:
        end = self.session.end_date
        monday_after = end + datetime.timedelta(days=7 - end.weekday())

        self.assertEqual(
            self.candidates(on=monday_after).status_code, status.HTTP_422_UNPROCESSABLE_ENTITY
        )

    def test_it_needs_the_create_key(self) -> None:
        user = UserFactory(tenant=self.tenant)
        grant(user, "timetable.timetable.view")
        authenticate(self.client, user)

        self.assertEqual(self.candidates().status_code, status.HTTP_403_FORBIDDEN)

    def test_the_query_count_does_not_grow_with_the_staff(self) -> None:
        def queries() -> int:
            with CaptureQueriesContext(connection) as captured:
                self.candidates()
            return len(captured)

        queries()  # warm any per-request caches (feature flag, permissions)
        before = queries()
        with tenant_context(self.tenant.id):
            for _ in range(5):
                StaffFactory(tenant=self.tenant, campus=self.campus)

        self.assertEqual(queries(), before)


class SubstitutionNamesTests(CoverTestCase):
    def test_the_queue_names_who_is_off_who_covers_and_where(self) -> None:
        self.allow("timetable.timetable.view")
        self.open_cover(on=MONDAY)

        row = self.client.get("/api/v1/teacher-substitutions").json()["data"][0]

        self.assertEqual(row["absent_staff_name"], self.teacher.full_name)
        self.assertEqual(row["substitute_staff_name"], self.cover.full_name)
        self.assertEqual(row["section_name"], self.section.name)
        self.assertEqual(row["subject_name"], self.subject.name)
        self.assertEqual(row["period_name"], self.period.name)
        self.assertEqual(row["slot_room_name"], self.room.name)
        self.assertIsNone(row["room_name"])

    def test_the_queue_query_count_does_not_grow_with_its_rows(self) -> None:
        self.allow("timetable.timetable.view")

        def queries() -> int:
            with CaptureQueriesContext(connection) as captured:
                self.client.get("/api/v1/teacher-substitutions")
            return len(captured)

        self.open_cover(on=MONDAY)
        queries()  # warm any per-request caches (feature flag, permissions)
        before = queries()
        for week in range(1, 5):
            self.open_cover(on=MONDAY + datetime.timedelta(weeks=week))

        self.assertEqual(queries(), before)

    def test_the_queue_is_searchable_by_name(self) -> None:
        self.allow("timetable.timetable.view")
        self.open_cover(on=MONDAY)

        found = self.client.get("/api/v1/teacher-substitutions?search=Baker").json()["data"]
        missing = self.client.get("/api/v1/teacher-substitutions?search=Nobody").json()["data"]

        self.assertEqual(len(found), 1)
        self.assertEqual(missing, [])
