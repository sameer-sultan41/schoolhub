"""The approvals contract — the correction queue and the leave review list.

Who reaches the correction queue (either key, ADR-0027), what each caller's record
scope shows them, that a correction's target resolves through the caller's own
scoped rows (an out-of-scope target is a 404), the names each record carries, and
that those names cost no query per row.
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework import status

from apps.attendance import services
from apps.attendance.models import (
    AttendanceCorrection,
    AttendanceStatus,
    CorrectionStatus,
    LeaveAppliesTo,
    LeaveApproval,
    LeaveRequest,
    LeaveType,
    RequesterType,
    StudentAttendance,
)
from apps.attendance.tests.base import AttendanceAPITestCase
from apps.attendance.tests.factories import (
    MARKING_DATE,
    AcademicSessionFactory,
    AttendanceCorrectionFactory,
    CampusFactory,
    ClassFactory,
    GuardianFactory,
    SectionFactory,
    StaffFactory,
    StudentAttendanceFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    StudentGuardianFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    enable_feature,
    grant,
)
from apps.attendance.tests.test_leave import next_monday
from apps.student_management.models import EnrollmentStatus
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

CORRECTIONS = "/api/v1/attendance-corrections"
LEAVE_REQUESTS = "/api/v1/leave-requests"
CREATE = "attendance.correction.create"
APPROVE = "attendance.correction.approve"
LEAVE_VIEW = "attendance.leave-request.view"
LEAVE_APPROVE = "attendance.leave-request.approve"
# A date past any lock window, so a row is locked by its date as well as its column.
LOCKED_DATE = MARKING_DATE - datetime.timedelta(days=30)


class ApprovalsTestCase(AttendanceAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.principal = UserFactory(tenant=self.tenant, first_name="Zainab", last_name="Qureshi")

    def sign_in(self, user, *keys: str, scope=RecordScope.ALL, scope_ref=None) -> None:
        grant(user, *keys, scope=scope, scope_ref=scope_ref)
        authenticate(self.client, user)

    def locked_row(self, student=None, *, section=None, period=None, marked_by=None, days_back=0):
        with tenant_context(self.tenant.id):
            return StudentAttendanceFactory(
                tenant=self.tenant,
                student=student or self.students[0],
                section=section or self.section,
                academic_session=self.session,
                period=period,
                attendance_date=LOCKED_DATE - datetime.timedelta(days=days_back),
                status=AttendanceStatus.ABSENT,
                is_locked=True,
                marked_by=(marked_by or self.teacher_user).pk,
            )

    def campus_b_locked_row(self):
        with tenant_context(self.tenant.id):
            campus_b = CampusFactory(tenant=self.tenant)
            section_b = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=campus_b
            )
            student_b = StudentFactory(tenant=self.tenant, campus=campus_b)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=student_b,
                academic_session=self.session,
                school_class=self.school_class,
                section=section_b,
            )
        return self.locked_row(student_b, section=section_b, marked_by=self.principal)

    def correction(self, row, requested_by) -> AttendanceCorrection:
        with tenant_context(self.tenant.id):
            return AttendanceCorrectionFactory(
                tenant=self.tenant, student_attendance=row, requested_by=requested_by.pk
            )

    def body(self, row) -> dict:
        return {
            "student_attendance_id": str(row.pk),
            "new_values": {"status": AttendanceStatus.PRESENT},
            "reason": "The student was in the science lab.",
        }

    def ids(self, response) -> set[str]:
        return {row["id"] for row in response.json()["data"]}

    def count(self, url: str) -> int:
        with CaptureQueriesContext(connection) as captured:
            response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return len(captured)


class CorrectionQueueAccessTests(ApprovalsTestCase):
    """The list and retrieve take either key (ADR-0027); scope decides the rows."""

    def setUp(self) -> None:
        super().setUp()
        self.requester = UserFactory(tenant=self.tenant)
        self.queued = self.correction(self.locked_row(), self.requester)

    def test_a_principal_with_only_the_approve_key_lists_the_queue(self) -> None:
        """Was a 403: the list was keyed `correction.create`, which approvers don't hold."""
        self.sign_in(self.principal, APPROVE)

        response = self.client.get(CORRECTIONS)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(self.ids(response), {str(self.queued.pk)})

    def test_a_principal_with_only_the_approve_key_retrieves_a_correction(self) -> None:
        self.sign_in(self.principal, APPROVE)

        response = self.client.get(f"{CORRECTIONS}/{self.queued.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

    def test_a_user_with_neither_key_is_refused(self) -> None:
        self.sign_in(self.principal, "attendance.student-attendance.view")

        self.assertEqual(self.client.get(CORRECTIONS).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(
            self.client.get(f"{CORRECTIONS}/{self.queued.pk}").status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_an_assigned_teacher_sees_only_their_own_requests(self) -> None:
        """Was `.none()`: the model had no `assigned` hook. Both rows are in their
        own section, so only the requester rule can separate them."""
        own = self.correction(self.locked_row(self.students[1]), self.teacher_user)
        self.sign_in(self.teacher_user, CREATE, scope=RecordScope.ASSIGNED)

        listed = self.client.get(CORRECTIONS)

        self.assertEqual(listed.status_code, status.HTTP_200_OK, listed.json())
        self.assertEqual(self.ids(listed), {str(own.pk)})
        self.assertEqual(
            self.client.get(f"{CORRECTIONS}/{self.queued.pk}").status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_mine_filters_to_the_callers_requests_or_to_everyone_elses(self) -> None:
        own = self.correction(self.locked_row(self.students[1]), self.principal)
        self.sign_in(self.principal, CREATE, APPROVE)

        self.assertEqual(self.ids(self.client.get(f"{CORRECTIONS}?mine=true")), {str(own.pk)})
        self.assertEqual(
            self.ids(self.client.get(f"{CORRECTIONS}?mine=false")), {str(self.queued.pk)}
        )
        self.assertEqual(self.ids(self.client.get(CORRECTIONS)), {str(own.pk), str(self.queued.pk)})


class CorrectionTargetScopeTests(ApprovalsTestCase):
    """The target resolves through the caller's scoped rows: outside them is a 404."""

    def sign_in_on_campus_a(self, user) -> None:
        self.sign_in(user, CREATE, scope=RecordScope.CAMPUS, scope_ref=self.campus.pk)

    def correction_count(self) -> int:
        with tenant_context(self.tenant.id):
            return AttendanceCorrection.objects.count()

    def test_a_campus_a_teacher_cannot_correct_a_campus_b_row(self) -> None:
        """The exploit: the target resolved tenant-wide, so this was a 201."""
        row = self.campus_b_locked_row()
        self.sign_in_on_campus_a(self.teacher_user)

        response = self.client.post(CORRECTIONS, self.body(row), format="json")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.correction_count(), 0)

    def test_a_campus_a_teacher_can_correct_a_campus_a_row(self) -> None:
        """The control for the test above: same caller, same body, own campus."""
        row = self.locked_row(marked_by=self.principal)
        self.sign_in_on_campus_a(self.teacher_user)

        response = self.client.post(CORRECTIONS, self.body(row), format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())

    def test_an_assigned_teacher_cannot_correct_a_section_they_neither_teach_nor_marked(
        self,
    ) -> None:
        with tenant_context(self.tenant.id):
            stranger = StudentFactory(tenant=self.tenant, campus=self.campus)
        row = self.locked_row(stranger, section=self.other_section, marked_by=self.principal)
        self.sign_in(self.teacher_user, CREATE, scope=RecordScope.ASSIGNED)

        response = self.client.post(CORRECTIONS, self.body(row), format="json")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.correction_count(), 0)

    def test_a_slot_teacher_corrects_their_own_locked_period_row_end_to_end(self) -> None:
        """Not the class teacher: the row is reachable only because they marked it."""
        slot_user = UserFactory(tenant=self.tenant, first_name="Imran", last_name="Siddiqui")
        with tenant_context(self.tenant.id):
            StaffFactory(tenant=self.tenant, campus=self.campus, user_id=slot_user.pk)
        row = self.locked_row(period=self.period, marked_by=slot_user)
        self.sign_in(slot_user, CREATE, scope=RecordScope.ASSIGNED)

        created = self.client.post(CORRECTIONS, self.body(row), format="json")

        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.json())
        correction = created.json()["data"]
        self.assertEqual(correction["period_name"], self.period.name)
        self.assertEqual(correction["requested_by_name"], "Imran Siddiqui")
        self.assertEqual(self.ids(self.client.get(CORRECTIONS)), {correction["id"]})

        self.sign_in(self.principal, APPROVE)
        approved = self.client.post(f"{CORRECTIONS}/{correction['id']}:approve", {}, format="json")

        self.assertEqual(approved.status_code, status.HTTP_200_OK, approved.json())
        self.assertEqual(approved.json()["data"]["status"], CorrectionStatus.APPROVED)
        self.assertEqual(approved.json()["data"]["reviewed_by_name"], "Zainab Qureshi")
        with tenant_context(self.tenant.id):
            row.refresh_from_db()
        self.assertEqual(row.status, AttendanceStatus.PRESENT)


class CampusApproverQueueTests(ApprovalsTestCase):
    """A campus-scoped approver's queue is their campus: the rest is a 404, never a decision."""

    def setUp(self) -> None:
        super().setUp()
        self.requester = UserFactory(tenant=self.tenant)
        self.campus_a = self.correction(self.locked_row(), self.requester)
        self.campus_b = self.correction(self.campus_b_locked_row(), self.requester)
        self.sign_in(self.principal, APPROVE, scope=RecordScope.CAMPUS, scope_ref=self.campus.pk)

    def assert_still_pending(self) -> None:
        with tenant_context(self.tenant.id):
            self.campus_b.refresh_from_db()
        self.assertEqual(self.campus_b.status, CorrectionStatus.PENDING)

    def test_the_queue_lists_only_their_campus(self) -> None:
        self.assertEqual(self.ids(self.client.get(CORRECTIONS)), {str(self.campus_a.pk)})

    def test_another_campus_correction_is_a_404(self) -> None:
        response = self.client.get(f"{CORRECTIONS}/{self.campus_b.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_approving_another_campus_correction_is_a_404(self) -> None:
        response = self.client.post(f"{CORRECTIONS}/{self.campus_b.pk}:approve", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assert_still_pending()

    def test_rejecting_another_campus_correction_is_a_404(self) -> None:
        response = self.client.post(f"{CORRECTIONS}/{self.campus_b.pk}:reject", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assert_still_pending()


class CorrectionRecordTests(ApprovalsTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.requester = UserFactory(tenant=self.tenant, first_name="Amna", last_name="Raza")
        self.student = self.students[0]
        self.row = self.locked_row(self.student, period=self.period)
        self.queued = self.correction(self.row, self.requester)
        self.sign_in(self.principal, CREATE, APPROVE)

    def test_a_correction_names_its_target_and_its_people(self) -> None:
        record = self.client.get(f"{CORRECTIONS}/{self.queued.pk}").json()["data"]

        self.assertEqual(record["student_id"], str(self.student.pk))
        self.assertEqual(record["student_name"], self.student.full_name)
        self.assertEqual(record["attendance_date"], self.row.attendance_date.isoformat())
        self.assertEqual(record["period_name"], self.period.name)
        self.assertEqual(record["requested_by_name"], "Amna Raza")
        self.assertIsNone(record["reviewed_by_name"])

    def test_a_daily_rows_period_name_is_null(self) -> None:
        daily = self.correction(self.locked_row(self.students[1]), self.requester)

        record = self.client.get(f"{CORRECTIONS}/{daily.pk}").json()["data"]

        self.assertIsNone(record["period_name"])

    def test_a_decision_names_the_reviewer(self) -> None:
        response = self.client.post(
            f"{CORRECTIONS}/{self.queued.pk}:reject", {"review_note": "Correct."}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["reviewed_by_name"], "Zainab Qureshi")
        self.assertEqual(response.json()["data"]["student_name"], self.student.full_name)

    def test_the_queue_costs_no_query_per_row(self) -> None:
        self.count(CORRECTIONS)  # warm the per-user permission caches
        before = self.count(CORRECTIONS)

        for index, student in enumerate(self.students[1:], start=1):
            requester = UserFactory(tenant=self.tenant, first_name=f"Requester{index}")
            self.correction(self.locked_row(student, period=self.period), requester)
        reviewed = self.correction(self.locked_row(self.students[1], days_back=1), self.requester)
        with tenant_context(self.tenant.id):
            services.decide_correction(
                correction=reviewed, approve=False, reviewer_id=self.principal.pk
            )

        self.assertEqual(self.count(CORRECTIONS), before)


class LeaveReviewRecordTests(ApprovalsTestCase):
    """The names a leave reviewer reads: student, section, type, submitter, approver."""

    def setUp(self) -> None:
        super().setUp()
        self.guardian_user = UserFactory(tenant=self.tenant, first_name="Noor", last_name="Usman")
        with tenant_context(self.tenant.id):
            self.leave_type = LeaveType.objects.create(
                tenant=self.tenant, name="Sick Leave", code="SICK", applies_to=LeaveAppliesTo.BOTH
            )
        self.sign_in(self.principal, LEAVE_VIEW, LEAVE_APPROVE)

    def leave(self, student, *, submitted_by=None, weeks_ahead: int = 1) -> LeaveRequest:
        start = next_monday(weeks_ahead)
        actor = (submitted_by or self.guardian_user).pk
        with tenant_context(self.tenant.id):
            request = LeaveRequest.objects.create(
                tenant=self.tenant,
                requester_type=RequesterType.STUDENT,
                student=student,
                submitted_by=actor,
                leave_type=self.leave_type,
                start_date=start,
                end_date=start + datetime.timedelta(days=1),
                days_count=Decimal(2),
                reason="Fever.",
                created_by=actor,
                updated_by=actor,
            )
            LeaveApproval.objects.create(
                tenant=self.tenant,
                leave_request=request,
                level=1,
                required_permission=LEAVE_APPROVE,
                created_by=actor,
                updated_by=actor,
            )
        return request

    def record(self, leave_request) -> dict:
        response = self.client.get(f"{LEAVE_REQUESTS}/{leave_request.pk}")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return response.json()["data"]

    def test_a_leave_request_names_the_student_section_type_and_submitter(self) -> None:
        student = self.students[0]
        record = self.record(self.leave(student))

        self.assertEqual(record["student_name"], student.full_name)
        self.assertEqual(record["admission_number"], student.admission_number)
        self.assertEqual(record["section_name"], self.section.name)
        self.assertEqual(record["leave_type_name"], "Sick Leave")
        self.assertEqual(record["submitted_by_name"], "Noor Usman")
        self.assertIsNone(record["approvals"][0]["approver_name"])

    def test_the_section_is_the_active_enrollment_in_the_current_session(self) -> None:
        """A past session's enrollment, or a withdrawn one, is not today's section."""
        with tenant_context(self.tenant.id):
            past_session = AcademicSessionFactory(tenant=self.tenant, is_current=False)
            moved_on = StudentFactory(tenant=self.tenant, campus=self.campus)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=moved_on,
                academic_session=past_session,
                school_class=self.school_class,
                section=self.other_section,
            )
            withdrawn = StudentFactory(tenant=self.tenant, campus=self.campus)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=withdrawn,
                academic_session=self.session,
                school_class=self.school_class,
                section=self.section,
                status=EnrollmentStatus.WITHDRAWN,
            )

        self.assertIsNone(self.record(self.leave(moved_on))["section_name"])
        self.assertIsNone(self.record(self.leave(withdrawn))["section_name"])

    def test_a_past_sessions_section_does_not_shadow_the_current_one(self) -> None:
        student = self.students[0]
        with tenant_context(self.tenant.id):
            past_session = AcademicSessionFactory(tenant=self.tenant, is_current=False)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=student,
                academic_session=past_session,
                school_class=self.school_class,
                section=self.other_section,
            )

        self.assertEqual(self.record(self.leave(student))["section_name"], self.section.name)

    def test_approving_names_the_approver_and_keeps_the_section(self) -> None:
        leave_request = self.leave(self.students[0])

        response = self.client.post(
            f"{LEAVE_REQUESTS}/{leave_request.pk}:approve", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        data = response.json()["data"]
        self.assertEqual(data["approvals"][0]["approver_name"], "Zainab Qureshi")
        self.assertEqual(data["section_name"], self.section.name)

    def test_a_campus_staff_member_submits_for_their_child_on_another_campus(self) -> None:
        """Was a 500: the create re-read went through their campus scope, which the
        child's campus is outside, though the guardian link admitted the request."""
        parent = UserFactory(tenant=self.tenant)
        child = self.campus_b_locked_row().student
        with tenant_context(self.tenant.id):
            guardian = GuardianFactory(tenant=self.tenant, user_id=parent.pk)
            StudentGuardianFactory(
                tenant=self.tenant, student=child, guardian=guardian, has_portal_access=True
            )
            child_section = child.enrollments.get().section
        self.sign_in(
            parent,
            "attendance.leave-request.create",
            LEAVE_VIEW,
            scope=RecordScope.CAMPUS,
            scope_ref=self.campus.pk,
        )
        start = next_monday()

        response = self.client.post(
            LEAVE_REQUESTS,
            {
                "student_id": str(child.pk),
                "leave_type_id": str(self.leave_type.pk),
                "start_date": start.isoformat(),
                "end_date": start.isoformat(),
                "reason": "Dentist.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        self.assertEqual(response.json()["data"]["section_name"], child_section.name)

    def test_the_review_list_costs_no_query_per_row(self) -> None:
        self.leave(self.students[0])
        self.count(LEAVE_REQUESTS)
        before = self.count(LEAVE_REQUESTS)

        for index, student in enumerate(self.students[1:], start=1):
            submitter = UserFactory(tenant=self.tenant, first_name=f"Guardian{index}")
            approver = UserFactory(tenant=self.tenant, first_name=f"Approver{index}")
            leave_request = self.leave(student, submitted_by=submitter, weeks_ahead=index + 1)
            with tenant_context(self.tenant.id):
                services.decide_leave_step(
                    request=leave_request, approve=False, approver_id=approver.pk
                )

        self.assertEqual(self.count(LEAVE_REQUESTS), before)


class ApprovalsCrossTenantTests(ApprovalsTestCase):
    """AGENTS.md invariant 2: another tenant's records are 404s, never 403s."""

    def setUp(self) -> None:
        super().setUp()
        self.other = TenantFactory()
        other_user = UserFactory(tenant=self.other)
        enable_feature(self.other, "module.attendance")
        with tenant_context(self.other.id):
            campus = CampusFactory(tenant=self.other)
            session = AcademicSessionFactory(tenant=self.other, is_current=True)
            school_class = ClassFactory(tenant=self.other, level=6)
            section = SectionFactory(tenant=self.other, school_class=school_class, campus=campus)
            student = StudentFactory(tenant=self.other, campus=campus)
            self.foreign_row = StudentAttendanceFactory(
                tenant=self.other,
                student=student,
                section=section,
                academic_session=session,
                attendance_date=LOCKED_DATE,
                status=AttendanceStatus.ABSENT,
                is_locked=True,
                marked_by=other_user.pk,
            )
            self.foreign_correction = AttendanceCorrectionFactory(
                tenant=self.other, student_attendance=self.foreign_row, requested_by=other_user.pk
            )
            leave_type = LeaveType.objects.create(tenant=self.other, name="Sick", code="SICK")
            self.foreign_leave = LeaveRequest.objects.create(
                tenant=self.other,
                requester_type=RequesterType.STUDENT,
                student=student,
                submitted_by=other_user.pk,
                leave_type=leave_type,
                start_date=next_monday(),
                end_date=next_monday(),
                days_count=Decimal(1),
                reason="Fever.",
            )
        self.sign_in(self.principal, CREATE, APPROVE, LEAVE_VIEW, LEAVE_APPROVE)

    def test_another_tenants_correction_is_a_404_to_an_approver(self) -> None:
        response = self.client.get(f"{CORRECTIONS}/{self.foreign_correction.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.get(CORRECTIONS).json()["data"], [])

    def test_correcting_another_tenants_row_is_a_404(self) -> None:
        response = self.client.post(CORRECTIONS, self.body(self.foreign_row), format="json")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        with tenant_context(self.other.id):
            self.assertEqual(
                StudentAttendance.objects.get(pk=self.foreign_row.pk).corrections.count(), 1
            )

    def test_another_tenants_leave_request_is_a_404_to_a_reviewer(self) -> None:
        response = self.client.get(f"{LEAVE_REQUESTS}/{self.foreign_leave.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.get(LEAVE_REQUESTS).json()["data"], [])
