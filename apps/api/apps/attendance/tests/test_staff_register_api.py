"""`GET /staff-attendance/register` — the staff register for one date.

Active staff in name order, each with the date's record merged and an `on_leave`
flag; scoped the way `/staff-attendance` is; a foreign department is a 404; and the
query count does not grow with the number of staff.
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from django.db import connection
from django.test.utils import CaptureQueriesContext
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
from apps.attendance.tests.base import AttendanceAPITestCase
from apps.attendance.tests.factories import (
    MARKING_DATE,
    CampusFactory,
    StaffFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    enable_feature,
    grant,
)
from apps.school_organization.tests.factories import DepartmentFactory
from apps.staff_management.models import EmploymentStatus
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

STAFF_REGISTER = "/api/v1/staff-attendance/register"
MARK = "attendance.staff-attendance.mark"
VIEW = "attendance.staff-attendance.view"


class StaffRegisterTestCase(AttendanceAPITestCase):
    """Three active staff on one campus: the fixture's class teacher, Ahmed and Khan."""

    def setUp(self) -> None:
        super().setUp()
        grant(self.user, MARK, VIEW, scope=RecordScope.ALL)
        with tenant_context(self.tenant.id):
            self.department = DepartmentFactory(tenant=self.tenant, name="Sciences")
            self.zara = StaffFactory(
                tenant=self.tenant,
                campus=self.campus,
                first_name="Zara",
                last_name="Ahmed",
                department=self.department,
            )
            self.bilal = StaffFactory(
                tenant=self.tenant, campus=self.campus, first_name="Bilal", last_name="Khan"
            )
            self.leave_type = LeaveType.objects.create(
                tenant=self.tenant, name="Casual", code="CAS", applies_to=LeaveAppliesTo.STAFF
            )

    def url(self, on_date: datetime.date = MARKING_DATE, **params) -> str:
        query = "&".join(f"{key}={value}" for key, value in {"date": on_date, **params}.items())
        return f"{STAFF_REGISTER}?{query}"

    def rows(self, **params) -> list[dict]:
        response = self.client.get(self.url(**params))
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return response.json()["data"]

    def mark(self, staff, value=StaffAttendanceStatus.PRESENT, **fields) -> StaffAttendance:
        with tenant_context(self.tenant.id):
            return StaffAttendance.objects.create(
                tenant=self.tenant,
                staff=staff,
                attendance_date=MARKING_DATE,
                status=value,
                marked_by=self.user.pk,
                **fields,
            )

    def staff_leave(self, staff, leave_status=LeaveStatus.APPROVED) -> LeaveRequest:
        with tenant_context(self.tenant.id):
            return LeaveRequest.objects.create(
                tenant=self.tenant,
                requester_type=RequesterType.STAFF,
                staff=staff,
                submitted_by=self.user.pk,
                leave_type=self.leave_type,
                start_date=MARKING_DATE - datetime.timedelta(days=1),
                end_date=MARKING_DATE + datetime.timedelta(days=1),
                days_count=Decimal(3),
                reason="Family wedding.",
                status=leave_status,
                created_by=self.user.pk,
                updated_by=self.user.pk,
            )


class StaffRegisterShapeTests(StaffRegisterTestCase):
    def test_active_staff_come_in_name_order_with_their_names(self) -> None:
        rows = self.rows()

        self.assertEqual(
            [row["staff_id"] for row in rows],
            [str(self.zara.pk), str(self.bilal.pk), str(self.teacher.pk)],
        )
        self.assertEqual(rows[0]["staff_name"], "Zara Ahmed")
        self.assertEqual(rows[0]["employee_number"], self.zara.employee_number)
        self.assertEqual(rows[0]["department_name"], "Sciences")
        self.assertIsNone(rows[1]["department_name"])

    def test_an_unmarked_member_has_no_record_and_a_marked_one_has_theirs(self) -> None:
        marked = self.mark(
            self.bilal, StaffAttendanceStatus.LATE, check_in_time=datetime.time(8, 30)
        )

        by_staff = {row["staff_id"]: row for row in self.rows()}

        self.assertIsNone(by_staff[str(self.zara.pk)]["record"])
        record = by_staff[str(self.bilal.pk)]["record"]
        self.assertEqual(record["id"], str(marked.pk))
        self.assertEqual(record["status"], StaffAttendanceStatus.LATE)
        self.assertEqual(record["staff_name"], "Bilal Khan")
        self.assertEqual(record["employee_number"], self.bilal.employee_number)

    def test_staff_who_are_not_active_or_had_not_joined_are_left_out(self) -> None:
        with tenant_context(self.tenant.id):
            resigned = StaffFactory(
                tenant=self.tenant,
                campus=self.campus,
                employment_status=EmploymentStatus.RESIGNED,
            )
            joining_later = StaffFactory(
                tenant=self.tenant,
                campus=self.campus,
                joining_date=MARKING_DATE + datetime.timedelta(days=1),
            )

        listed = {row["staff_id"] for row in self.rows()}

        self.assertNotIn(str(resigned.pk), listed)
        self.assertNotIn(str(joining_later.pk), listed)

    def test_a_department_narrows_the_register(self) -> None:
        rows = self.rows(department_id=self.department.pk)

        self.assertEqual([row["staff_id"] for row in rows], [str(self.zara.pk)])


class StaffRegisterLeaveTests(StaffRegisterTestCase):
    def test_approved_leave_covering_the_date_flags_the_member(self) -> None:
        self.staff_leave(self.zara)

        by_staff = {row["staff_id"]: row for row in self.rows()}

        self.assertTrue(by_staff[str(self.zara.pk)]["on_leave"])
        self.assertFalse(by_staff[str(self.bilal.pk)]["on_leave"])

    def test_pending_leave_does_not(self) -> None:
        self.staff_leave(self.zara, leave_status=LeaveStatus.PENDING)

        by_staff = {row["staff_id"]: row for row in self.rows()}

        self.assertFalse(by_staff[str(self.zara.pk)]["on_leave"])

    def test_an_on_leave_record_flags_the_member(self) -> None:
        self.mark(self.bilal, StaffAttendanceStatus.ON_LEAVE)

        by_staff = {row["staff_id"]: row for row in self.rows()}

        self.assertTrue(by_staff[str(self.bilal.pk)]["on_leave"])


class StaffRegisterAccessTests(StaffRegisterTestCase):
    def test_the_view_key_alone_cannot_open_the_register(self) -> None:
        reader = UserFactory(tenant=self.tenant)
        grant(reader, VIEW, scope=RecordScope.ALL)
        authenticate(self.client, reader)

        self.assertEqual(self.client.get(self.url()).status_code, status.HTTP_403_FORBIDDEN)

    def test_a_campus_scoped_marker_sees_only_their_campus(self) -> None:
        with tenant_context(self.tenant.id):
            other_campus = CampusFactory(tenant=self.tenant)
            elsewhere = StaffFactory(tenant=self.tenant, campus=other_campus)
        clerk = UserFactory(tenant=self.tenant)
        grant(clerk, MARK, scope=RecordScope.CAMPUS, scope_ref=self.campus.pk)
        authenticate(self.client, clerk)

        listed = {row["staff_id"] for row in self.rows()}

        self.assertIn(str(self.zara.pk), listed)
        self.assertNotIn(str(elsewhere.pk), listed)

    def test_an_own_scoped_marker_sees_only_themself(self) -> None:
        grant(self.teacher_user, MARK, scope=RecordScope.OWN)
        authenticate(self.client, self.teacher_user)

        self.assertEqual([row["staff_id"] for row in self.rows()], [str(self.teacher.pk)])


class StaffRegisterCrossTenantTests(StaffRegisterTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.other = TenantFactory()
        enable_feature(self.other, "module.attendance")
        with tenant_context(self.other.id):
            other_campus = CampusFactory(tenant=self.other)
            self.foreign_department = DepartmentFactory(tenant=self.other)
            self.foreign_staff = StaffFactory(
                tenant=self.other, campus=other_campus, department=self.foreign_department
            )

    def test_another_tenants_department_is_a_404(self) -> None:
        response = self.client.get(self.url(department_id=self.foreign_department.pk))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_another_tenants_staff_are_absent(self) -> None:
        listed = {row["staff_id"] for row in self.rows()}

        self.assertNotIn(str(self.foreign_staff.pk), listed)


class StaffRegisterQueryCountTests(StaffRegisterTestCase):
    def count(self) -> int:
        with CaptureQueriesContext(connection) as captured:
            response = self.client.get(self.url())
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return len(captured)

    def test_the_register_costs_no_query_per_member(self) -> None:
        self.mark(self.zara)
        self.count()  # warm the per-user permission caches
        before = self.count()

        # Each in a department of its own, so an unjoined `department` costs a query per member.
        with tenant_context(self.tenant.id):
            more = [
                StaffFactory(
                    tenant=self.tenant,
                    campus=self.campus,
                    department=DepartmentFactory(tenant=self.tenant),
                )
                for _ in range(4)
            ]
        for member in more:
            self.mark(member, StaffAttendanceStatus.LATE, check_in_time=datetime.time(8, 30))
        self.staff_leave(more[0])

        self.assertEqual(self.count(), before)
