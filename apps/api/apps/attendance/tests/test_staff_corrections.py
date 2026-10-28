"""Corrections to a locked staff attendance row (§5.5 over §5.2).

A staff row is named by `staff_attendance_id`, resolved through the caller's scoped
staff attendance (outside it is a 404), and its proposal is status and times only.
Approval recomputes the late and early-departure minutes from the staff day window.
A campus approver's queue holds the staff corrections on their campus and no other.
"""

from __future__ import annotations

import datetime

from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework import status

from apps.attendance import services
from apps.attendance.models import (
    AttendanceCorrection,
    AttendanceStatus,
    CorrectionStatus,
    CorrectionSubjectType,
    StaffAttendance,
    StaffAttendanceStatus,
)
from apps.attendance.tests.base import AttendanceAPITestCase
from apps.attendance.tests.factories import (
    MARKING_DATE,
    AttendanceCorrectionFactory,
    CampusFactory,
    StaffFactory,
    StudentAttendanceFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    configure_academic,
    enable_feature,
    grant,
)
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

CORRECTIONS = "/api/v1/attendance-corrections"
CREATE = "attendance.correction.create"
APPROVE = "attendance.correction.approve"
# A date past any lock window, so a row is locked by its date as well as its column.
LOCKED_DATE = MARKING_DATE - datetime.timedelta(days=30)


class StaffCorrectionTestCase(AttendanceAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        configure_academic(
            self.tenant, day_window={"start": "08:00", "end": "14:00", "grace_minutes": 10}
        )
        self.hr_clerk = UserFactory(tenant=self.tenant, first_name="Hina", last_name="Malik")
        self.principal = UserFactory(tenant=self.tenant, first_name="Zainab", last_name="Qureshi")
        with tenant_context(self.tenant.id):
            self.staff = StaffFactory(
                tenant=self.tenant, campus=self.campus, first_name="Bilal", last_name="Khan"
            )
        self.row = self.staff_row(self.staff)
        self.sign_in(self.hr_clerk, CREATE)

    def sign_in(self, user, *keys: str, scope=RecordScope.ALL, scope_ref=None) -> None:
        grant(user, *keys, scope=scope, scope_ref=scope_ref)
        authenticate(self.client, user)

    def staff_row(self, staff, *, on_date=LOCKED_DATE, locked=True) -> StaffAttendance:
        with tenant_context(self.tenant.id):
            return StaffAttendance.objects.create(
                tenant=self.tenant,
                staff=staff,
                attendance_date=on_date,
                status=StaffAttendanceStatus.ABSENT,
                is_locked=locked,
                marked_by=self.user.pk,
            )

    def locked_student_row(self):
        with tenant_context(self.tenant.id):
            return StudentAttendanceFactory(
                tenant=self.tenant,
                student=self.students[0],
                section=self.section,
                academic_session=self.session,
                attendance_date=LOCKED_DATE,
                status=AttendanceStatus.ABSENT,
                is_locked=True,
                marked_by=self.user.pk,
            )

    def body(self, row=None, **new_values) -> dict:
        return {
            "staff_attendance_id": str((row or self.row).pk),
            "new_values": new_values or {"status": StaffAttendanceStatus.PRESENT},
            "reason": "The gate log shows them in.",
        }

    def raise_correction(self, row=None, **new_values):
        return self.client.post(CORRECTIONS, self.body(row, **new_values), format="json")

    def correction_count(self) -> int:
        with tenant_context(self.tenant.id):
            return AttendanceCorrection.objects.count()


class StaffCorrectionFlowTests(StaffCorrectionTestCase):
    def test_a_staff_correction_end_to_end_recomputes_both_minutes(self) -> None:
        created = self.raise_correction(
            status=StaffAttendanceStatus.LATE, check_in_time="08:40", check_out_time="12:30"
        )

        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.json())
        record = created.json()["data"]
        self.assertEqual(record["subject_type"], CorrectionSubjectType.STAFF)
        self.assertEqual(record["staff_attendance_id"], str(self.row.pk))
        self.assertIsNone(record["student_attendance_id"])
        self.assertIsNone(record["student_name"])
        self.assertEqual(record["staff_name"], "Bilal Khan")
        self.assertEqual(record["employee_number"], self.staff.employee_number)
        self.assertEqual(record["attendance_date"], LOCKED_DATE.isoformat())
        self.assertEqual(
            record["old_values"],
            {"status": StaffAttendanceStatus.ABSENT, "check_in_time": None, "check_out_time": None},
        )

        self.sign_in(self.principal, APPROVE)
        approved = self.client.post(f"{CORRECTIONS}/{record['id']}:approve", {}, format="json")

        self.assertEqual(approved.status_code, status.HTTP_200_OK, approved.json())
        self.assertEqual(approved.json()["data"]["status"], CorrectionStatus.APPROVED)
        self.assertEqual(approved.json()["data"]["staff_name"], "Bilal Khan")
        with tenant_context(self.tenant.id):
            self.row.refresh_from_db()
        self.assertEqual(self.row.status, StaffAttendanceStatus.LATE)
        self.assertEqual(self.row.check_in_time, datetime.time(8, 40))
        self.assertEqual(self.row.check_out_time, datetime.time(12, 30))
        self.assertEqual(self.row.late_minutes, 40)
        self.assertEqual(self.row.early_departure_minutes, 90)
        self.assertEqual(self.row.updated_by, self.principal.pk)

    def test_approval_clears_the_minutes_when_the_status_leaves_late(self) -> None:
        with tenant_context(self.tenant.id):
            self.row.status = StaffAttendanceStatus.LATE
            self.row.check_in_time = datetime.time(8, 40)
            self.row.late_minutes = 40
            self.row.save(update_fields=["status", "check_in_time", "late_minutes", "updated_at"])
        created = self.raise_correction(status=StaffAttendanceStatus.PRESENT)

        self.sign_in(self.principal, APPROVE)
        self.client.post(f"{CORRECTIONS}/{created.json()['data']['id']}:approve", {}, format="json")

        with tenant_context(self.tenant.id):
            self.row.refresh_from_db()
        self.assertEqual(self.row.status, StaffAttendanceStatus.PRESENT)
        self.assertIsNone(self.row.late_minutes)

    def test_a_correction_to_absent_that_keeps_its_times_counts_no_minutes(self) -> None:
        """A payroll input: an absent day has no early leave, whatever times it kept."""
        with tenant_context(self.tenant.id):
            self.row.status = StaffAttendanceStatus.LATE
            self.row.check_in_time = datetime.time(8, 40)
            self.row.check_out_time = datetime.time(12, 30)
            self.row.late_minutes = 40
            self.row.early_departure_minutes = 90
            self.row.save(
                update_fields=[
                    "status",
                    "check_in_time",
                    "check_out_time",
                    "late_minutes",
                    "early_departure_minutes",
                    "updated_at",
                ]
            )
        # Only the status changes: the row keeps its times.
        created = self.raise_correction(status=StaffAttendanceStatus.ABSENT)
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.json())

        self.sign_in(self.principal, APPROVE)
        approved = self.client.post(
            f"{CORRECTIONS}/{created.json()['data']['id']}:approve", {}, format="json"
        )

        self.assertEqual(approved.status_code, status.HTTP_200_OK, approved.json())
        with tenant_context(self.tenant.id):
            self.row.refresh_from_db()
        self.assertEqual(self.row.status, StaffAttendanceStatus.ABSENT)
        self.assertEqual(self.row.check_out_time, datetime.time(12, 30))
        self.assertIsNone(self.row.late_minutes)
        self.assertIsNone(self.row.early_departure_minutes)

    def test_an_unlocked_staff_row_is_refused(self) -> None:
        with tenant_context(self.tenant.id):
            member = StaffFactory(tenant=self.tenant, campus=self.campus)
        unlocked = self.staff_row(member, on_date=MARKING_DATE, locked=False)

        response = self.raise_correction(unlocked)

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("staff_attendance_id", response.content.decode())
        self.assertIn(services.CORRECTION_STILL_EDITABLE, response.content.decode())
        self.assertEqual(self.correction_count(), 0)

    def test_a_check_out_before_the_check_in_is_refused_when_raised(self) -> None:
        response = self.raise_correction(check_in_time="09:00", check_out_time="08:30")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn(services.CHECK_OUT_BEFORE_CHECK_IN, response.content.decode())


class StaffCorrectionSubjectTests(StaffCorrectionTestCase):
    """§11: a correction's subject cannot decide it, even when someone else raised it."""

    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.subject = StaffFactory(
                tenant=self.tenant, campus=self.campus, user_id=self.principal.pk
            )
        self.subject_row = self.staff_row(self.subject)
        created = self.raise_correction(self.subject_row)
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.json())
        self.record = created.json()["data"]

    def decide(self, action: str):
        return self.client.post(f"{CORRECTIONS}/{self.record['id']}:{action}", {}, format="json")

    def assert_refused_as_subject(self, response) -> None:
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("reviewed_by", response.content.decode())
        self.assertIn(services.OWN_ATTENDANCE_CORRECTION, response.content.decode())
        with tenant_context(self.tenant.id):
            correction = AttendanceCorrection.objects.get(pk=self.record["id"])
            self.subject_row.refresh_from_db()
        self.assertEqual(correction.status, CorrectionStatus.PENDING)
        self.assertEqual(self.subject_row.status, StaffAttendanceStatus.ABSENT)

    def test_the_subject_user_is_exposed_on_a_staff_correction(self) -> None:
        self.assertEqual(self.record["subject_user_id"], str(self.principal.pk))

    def test_the_subject_cannot_approve_a_correction_to_their_own_attendance(self) -> None:
        self.sign_in(self.principal, APPROVE)

        self.assert_refused_as_subject(self.decide("approve"))

    def test_the_subject_cannot_reject_a_correction_to_their_own_attendance(self) -> None:
        self.sign_in(self.principal, APPROVE)

        self.assert_refused_as_subject(self.decide("reject"))

    def test_an_approver_who_is_not_the_subject_can_still_approve(self) -> None:
        self.sign_in(UserFactory(tenant=self.tenant), APPROVE)

        response = self.decide("approve")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["status"], CorrectionStatus.APPROVED)
        self.assertEqual(response.json()["data"]["subject_user_id"], str(self.principal.pk))

    def test_a_student_correction_has_no_subject_user(self) -> None:
        student_row = self.locked_student_row()
        with tenant_context(self.tenant.id):
            correction = AttendanceCorrectionFactory(
                tenant=self.tenant, student_attendance=student_row, requested_by=self.hr_clerk.pk
            )
        self.sign_in(self.principal, APPROVE)

        response = self.client.get(f"{CORRECTIONS}/{correction.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertIsNone(response.json()["data"]["subject_user_id"])


class StaffCorrectionValidationTests(StaffCorrectionTestCase):
    def assert_refused(self, body: dict) -> None:
        response = self.client.post(CORRECTIONS, body, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, response.json())
        self.assertEqual(self.correction_count(), 0)

    def test_on_leave_cannot_be_proposed(self) -> None:
        """The mirror of the student rule: it means an approved leave request exists."""
        self.assert_refused(self.body(status=StaffAttendanceStatus.ON_LEAVE))

    def test_a_student_only_status_is_refused(self) -> None:
        self.assert_refused(self.body(status=AttendanceStatus.EXCUSED))

    def test_remarks_are_not_correctable_on_a_staff_row(self) -> None:
        self.assert_refused(self.body(remarks="Edited."))

    def test_naming_both_targets_is_refused(self) -> None:
        student_row = self.locked_student_row()

        self.assert_refused({**self.body(), "student_attendance_id": str(student_row.pk)})

    def test_naming_no_target_is_refused(self) -> None:
        body = self.body()
        del body["staff_attendance_id"]

        self.assert_refused(body)


class StaffCorrectionScopeTests(StaffCorrectionTestCase):
    """A target resolves through the caller's scoped staff rows; a campus queue is theirs."""

    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.campus_b = CampusFactory(tenant=self.tenant)
            self.staff_b = StaffFactory(tenant=self.tenant, campus=self.campus_b)
        self.row_b = self.staff_row(self.staff_b)

    def correction(self, row) -> AttendanceCorrection:
        with tenant_context(self.tenant.id):
            return AttendanceCorrectionFactory(
                tenant=self.tenant,
                subject_type=CorrectionSubjectType.STAFF,
                staff_attendance=row,
                requested_by=self.hr_clerk.pk,
                old_values={"status": StaffAttendanceStatus.ABSENT.value},
                new_values={"status": StaffAttendanceStatus.PRESENT.value},
            )

    def ids(self, response) -> set[str]:
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return {row["id"] for row in response.json()["data"]}

    def test_a_campus_a_clerk_cannot_correct_a_campus_b_staff_row(self) -> None:
        clerk = UserFactory(tenant=self.tenant)
        self.sign_in(clerk, CREATE, scope=RecordScope.CAMPUS, scope_ref=self.campus.pk)

        self.assertEqual(self.raise_correction(self.row_b).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.correction_count(), 0)

    def test_a_campus_a_clerk_can_correct_a_campus_a_staff_row(self) -> None:
        clerk = UserFactory(tenant=self.tenant)
        self.sign_in(clerk, CREATE, scope=RecordScope.CAMPUS, scope_ref=self.campus.pk)

        response = self.raise_correction(self.row)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())

    def test_a_campus_approver_decides_staff_corrections_on_their_campus_only(self) -> None:
        on_campus = self.correction(self.row)
        elsewhere = self.correction(self.row_b)
        self.sign_in(self.principal, APPROVE, scope=RecordScope.CAMPUS, scope_ref=self.campus.pk)

        self.assertEqual(self.ids(self.client.get(CORRECTIONS)), {str(on_campus.pk)})
        self.assertEqual(
            self.client.get(f"{CORRECTIONS}/{elsewhere.pk}").status_code,
            status.HTTP_404_NOT_FOUND,
        )
        refused = self.client.post(f"{CORRECTIONS}/{elsewhere.pk}:approve", {}, format="json")
        self.assertEqual(refused.status_code, status.HTTP_404_NOT_FOUND)
        approved = self.client.post(f"{CORRECTIONS}/{on_campus.pk}:approve", {}, format="json")
        self.assertEqual(approved.status_code, status.HTTP_200_OK, approved.json())

    def test_a_campus_queue_holds_student_and_staff_corrections_together(self) -> None:
        """`filter_by_campus` covers both targets; the student path alone hid every staff one."""
        student_row = self.locked_student_row()
        with tenant_context(self.tenant.id):
            student_correction = AttendanceCorrectionFactory(
                tenant=self.tenant, student_attendance=student_row, requested_by=self.hr_clerk.pk
            )
        staff_correction = self.correction(self.row)
        self.sign_in(self.principal, APPROVE, scope=RecordScope.CAMPUS, scope_ref=self.campus.pk)

        self.assertEqual(
            self.ids(self.client.get(CORRECTIONS)),
            {str(student_correction.pk), str(staff_correction.pk)},
        )

    def test_the_queue_costs_no_query_per_staff_correction(self) -> None:
        self.correction(self.row)
        self.sign_in(self.principal, APPROVE)

        def count() -> int:
            with CaptureQueriesContext(connection) as captured:
                self.ids(self.client.get(CORRECTIONS))
            return len(captured)

        count()  # warm the per-user permission caches
        before = count()
        for _ in range(3):
            with tenant_context(self.tenant.id):
                member = StaffFactory(tenant=self.tenant, campus=self.campus)
            self.correction(self.staff_row(member))

        self.assertEqual(count(), before)


class StaffCorrectionCrossTenantTests(StaffCorrectionTestCase):
    def test_another_tenants_staff_row_is_a_404(self) -> None:
        other = TenantFactory()
        other_user = UserFactory(tenant=other)
        enable_feature(other, "module.attendance")
        with tenant_context(other.id):
            foreign_staff = StaffFactory(tenant=other, campus=CampusFactory(tenant=other))
            foreign_row = StaffAttendance.objects.create(
                tenant=other,
                staff=foreign_staff,
                attendance_date=LOCKED_DATE,
                status=StaffAttendanceStatus.ABSENT,
                is_locked=True,
                marked_by=other_user.pk,
            )

        response = self.raise_correction(foreign_row)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.correction_count(), 0)
