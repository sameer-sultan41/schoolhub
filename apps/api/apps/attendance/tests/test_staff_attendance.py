"""Staff attendance, and the absent-teacher signal it emits — §5.2, §5.3, §18.

The cover feed is the edge `timetable.SubstitutionStatus.completed` has named as
missing since that module shipped, so it gets its own class here rather than
being folded into the marking tests.
"""

from __future__ import annotations

import datetime
from unittest import mock

from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone
from rest_framework import status

from apps.attendance import services
from apps.attendance.models import (
    StaffAttendance,
    StaffAttendanceSource,
    StaffAttendanceStatus,
)
from apps.attendance.tests.base import AttendanceAPITestCase
from apps.attendance.tests.factories import (
    MARKING_DATE,
    CampusFactory,
    StaffFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    configure_academic,
    grant,
    open_all_week,
)
from core.api.exceptions import Conflict, DomainRuleViolation
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

STAFF_ATTENDANCE = "/api/v1/staff-attendance"


class StaffAttendanceServiceTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        open_all_week(self.tenant)
        configure_academic(
            self.tenant, day_window={"start": "08:00", "end": "14:00", "grace_minutes": 10}
        )
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.staff = StaffFactory(tenant=self.tenant, campus=self.campus)

    def mark(self, **overrides) -> StaffAttendance:
        payload = {
            "staff": self.staff,
            "on_date": MARKING_DATE,
            "status": StaffAttendanceStatus.PRESENT,
            "actor_id": self.user.pk,
        }
        return services.mark_staff_attendance(**{**payload, **overrides})

    def test_a_staff_member_is_recorded_once_per_day(self) -> None:
        with tenant_context(self.tenant.id):
            self.mark()
            self.mark(status=StaffAttendanceStatus.LATE, check_in_time=datetime.time(8, 30))

            self.assertEqual(StaffAttendance.objects.alive().count(), 1)
            self.assertEqual(
                StaffAttendance.objects.alive().get().status, StaffAttendanceStatus.LATE
            )

    def test_a_second_row_for_the_same_day_is_refused_by_the_database(self) -> None:
        """One plain unique constraint here, where the student table needs two
        partial ones: a staff day is never per period."""
        with tenant_context(self.tenant.id):
            self.mark()

            with self.assertRaises(IntegrityError), transaction.atomic():
                StaffAttendance.objects.create(
                    tenant=self.tenant,
                    staff=self.staff,
                    attendance_date=MARKING_DATE,
                    status=StaffAttendanceStatus.ABSENT,
                    marked_by=self.user.pk,
                )

    def test_lateness_is_computed_from_the_tenant_window(self) -> None:
        with tenant_context(self.tenant.id):
            row = self.mark(status=StaffAttendanceStatus.LATE, check_in_time=datetime.time(8, 40))

            self.assertEqual(row.late_minutes, 40)

    def test_an_early_departure_is_computed(self) -> None:
        with tenant_context(self.tenant.id):
            row = self.mark(check_in_time=datetime.time(8, 0), check_out_time=datetime.time(12, 30))

            self.assertEqual(row.early_departure_minutes, 90)

    def test_checking_out_before_checking_in_is_refused(self) -> None:
        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation):
            self.mark(check_in_time=datetime.time(9, 0), check_out_time=datetime.time(8, 0))

    def test_on_leave_cannot_be_marked_by_hand(self) -> None:
        """The mirror of the student rule: it means an approved leave request
        exists, and hr-leave's approval writes it with the back-link."""
        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation):
            self.mark(status=StaffAttendanceStatus.ON_LEAVE)

    def test_a_locked_row_needs_a_correction(self) -> None:
        with tenant_context(self.tenant.id):
            row = self.mark()
            row.is_locked = True
            row.save(update_fields=["is_locked", "updated_at"])

            with self.assertRaises(Conflict):
                self.mark(status=StaffAttendanceStatus.ABSENT)

    def test_check_out_records_the_time_and_the_minutes(self) -> None:
        with tenant_context(self.tenant.id):
            row = self.mark(check_in_time=datetime.time(8, 0))

            updated = services.check_out_staff(
                row=row, check_out_time=datetime.time(13, 0), actor_id=self.user.pk
            )

            self.assertEqual(updated.check_out_time, datetime.time(13, 0))
            self.assertEqual(updated.early_departure_minutes, 60)

    def test_check_out_without_a_check_in_is_refused(self) -> None:
        with tenant_context(self.tenant.id):
            row = self.mark()

            with self.assertRaises(DomainRuleViolation):
                services.check_out_staff(
                    row=row, check_out_time=datetime.time(13, 0), actor_id=self.user.pk
                )


class CoverProposalTests(TestCase):
    """§18's outbound edge — marking a teacher absent offers cover."""

    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        open_all_week(self.tenant)
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.staff = StaffFactory(tenant=self.tenant, campus=self.campus)

    def mark(self, status_value) -> None:
        services.mark_staff_attendance(
            staff=self.staff,
            on_date=MARKING_DATE,
            status=status_value,
            actor_id=self.user.pk,
        )

    def test_marking_absent_queues_the_cover_proposal_once(self) -> None:
        """Only on a *transition* into absence: re-recording it must not raise a
        second round of proposals.

        `captureOnCommitCallbacks(execute=True)` because the enqueue is deferred
        to commit — deliberately, so a broker outage cannot roll back the
        attendance record — and a `TestCase` never commits, so without this the
        callback simply never runs and the assertion would pass for the wrong
        reason.
        """
        with (
            tenant_context(self.tenant.id),
            mock.patch("apps.attendance.tasks.propose_cover_for_absence.delay") as queued,
        ):
            with self.captureOnCommitCallbacks(execute=True):
                self.mark(StaffAttendanceStatus.ABSENT)
            with self.captureOnCommitCallbacks(execute=True):
                self.mark(StaffAttendanceStatus.ABSENT)

        self.assertEqual(queued.call_count, 1)

    def test_marking_present_queues_nothing(self) -> None:
        with (
            tenant_context(self.tenant.id),
            mock.patch("apps.attendance.tasks.propose_cover_for_absence.delay") as queued,
            self.captureOnCommitCallbacks(execute=True),
        ):
            self.mark(StaffAttendanceStatus.PRESENT)

        queued.assert_not_called()

    def test_a_holiday_status_offers_no_cover(self) -> None:
        """The school is shut; there are no classes to cover. `holiday` exists on
        this enum and not the student one precisely because a staff row is also a
        payroll input, and "shut" is not "did not come in"."""
        with (
            tenant_context(self.tenant.id),
            mock.patch("apps.attendance.tasks.propose_cover_for_absence.delay") as queued,
            self.captureOnCommitCallbacks(execute=True),
        ):
            self.mark(StaffAttendanceStatus.HOLIDAY)

        queued.assert_not_called()


class StaffAttendanceEndpointTests(AttendanceAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        configure_academic(
            self.tenant, day_window={"start": "08:00", "end": "14:00", "grace_minutes": 10}
        )
        self.hr = UserFactory(tenant=self.tenant)
        grant(
            self.hr,
            "attendance.staff-attendance.view",
            "attendance.staff-attendance.mark",
            scope=RecordScope.ALL,
        )
        authenticate(self.client, self.hr)

    def body(self, **overrides) -> dict:
        return {
            "staff_id": str(self.teacher.pk),
            "attendance_date": MARKING_DATE.isoformat(),
            "status": StaffAttendanceStatus.PRESENT,
            **overrides,
        }

    def test_hr_can_record_a_staff_members_day(self) -> None:
        response = self.client.post(STAFF_ATTENDANCE, self.body(), format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["data"]["source"], StaffAttendanceSource.MANUAL)

    def test_recording_your_own_arrival_is_a_self_check_in(self) -> None:
        """§5.2 allows it, and §13's report must be able to tell a self-report
        from an HR-verified one — so the source is derived, never sent."""
        authenticate(self.client, self.teacher_user)
        grant(
            self.teacher_user,
            "attendance.staff-attendance.view",
            "attendance.staff-attendance.mark",
            scope=RecordScope.ALL,
        )

        response = self.client.post(
            STAFF_ATTENDANCE, self.body(check_in_time="08:05:00"), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["data"]["source"], StaffAttendanceSource.SELF)

    def test_a_client_supplied_late_minutes_is_ignored(self) -> None:
        response = self.client.post(
            STAFF_ATTENDANCE,
            self.body(
                status=StaffAttendanceStatus.LATE,
                check_in_time="08:35:00",
                late_minutes=0,
            ),
            format="json",
        )

        self.assertEqual(response.data["data"]["late_minutes"], 35)

    def test_check_out_is_its_own_action(self) -> None:
        created = self.client.post(
            STAFF_ATTENDANCE, self.body(check_in_time="08:00:00"), format="json"
        )

        response = self.client.post(
            f"{STAFF_ATTENDANCE}/{created.data['data']['id']}:check-out",
            {"check_out_time": "13:00:00"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["early_departure_minutes"], 60)

    def test_a_staff_member_sees_only_their_own_row_under_own_scope(self) -> None:
        """§4's "every staff role (own)" — the widest `own` grant on the platform."""
        self.client.post(STAFF_ATTENDANCE, self.body(), format="json")
        authenticate(self.client, self.teacher_user)
        grant(self.teacher_user, "attendance.staff-attendance.view", scope=RecordScope.OWN)

        response = self.client.get(STAFF_ATTENDANCE)

        self.assertEqual(len(response.data["data"]), 1)
        self.assertEqual(response.data["data"][0]["staff_id"], self.teacher.pk)

    def test_a_restricted_principal_cannot_read_staff_attendance(self) -> None:
        """A student has no business reading a teacher's arrival time — §4 grants
        these keys to no restricted principal at all."""
        student_user = UserFactory(tenant=self.tenant)
        authenticate(self.client, student_user)
        grant(
            student_user,
            "attendance.staff-attendance.view",
            scope=RecordScope.ALL,
            is_restricted_principal=True,
        )

        response = self.client.get(STAFF_ATTENDANCE)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_the_view_key_alone_cannot_record(self) -> None:
        reader = UserFactory(tenant=self.tenant)
        authenticate(self.client, reader)
        grant(reader, "attendance.staff-attendance.view", scope=RecordScope.ALL)

        response = self.client.post(STAFF_ATTENDANCE, self.body(), format="json")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_another_tenants_row_is_a_404(self) -> None:
        other = TenantFactory()
        other_user = UserFactory(tenant=other)
        with tenant_context(other.id):
            other_campus = CampusFactory(tenant=other)
            foreign = StaffAttendance.objects.create(
                tenant=other,
                staff=StaffFactory(tenant=other, campus=other_campus),
                attendance_date=MARKING_DATE,
                status=StaffAttendanceStatus.PRESENT,
                marked_by=other_user.pk,
            )

        response = self.client.get(f"{STAFF_ATTENDANCE}/{foreign.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_future_date_is_refused(self) -> None:
        response = self.client.post(
            STAFF_ATTENDANCE,
            self.body(
                attendance_date=(timezone.localdate() + datetime.timedelta(days=1)).isoformat()
            ),
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
