"""§13's six reports, their record scoping, and their query counts.

The `assertNumQueries` assertions are the point of this file as much as the
numbers are. A register over a term is exactly the shape
`ENGINEERING_STANDARDS.md` §3's N+1 rule exists for, and a report that quietly
grew a query per student would still return the right answer — so only a query
count catches it.
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from rest_framework import status

from apps.attendance import reports, services
from apps.attendance.models import (
    AttendanceStatus,
    StaffAttendanceStatus,
    StudentAttendance,
)
from apps.attendance.tests.base import AttendanceAPITestCase
from apps.attendance.tests.factories import (
    MARKING_DATE,
    StaffFactory,
    StudentAttendanceFactory,
    UserFactory,
    authenticate,
    configure_academic,
    grant,
)
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

REPORTS = "/api/v1/reports/attendance-summary"


class ReportDataTestCase(AttendanceAPITestCase):
    """Three students over five days, with a deliberately uneven spread."""

    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()
        grant(
            self.user, "attendance.report.view", "attendance.report.export", scope=RecordScope.ALL
        )
        configure_academic(
            self.tenant, day_window={"start": "08:00", "end": "14:00", "grace_minutes": 10}
        )
        self.start = MARKING_DATE - datetime.timedelta(days=4)
        self.end = MARKING_DATE

        # student 0: present every day. student 1: absent 3 of 5.
        # student 2: two lates, one approved leave, two present.
        plan = {
            0: [AttendanceStatus.PRESENT] * 5,
            1: [
                AttendanceStatus.ABSENT,
                AttendanceStatus.ABSENT,
                AttendanceStatus.ABSENT,
                AttendanceStatus.PRESENT,
                AttendanceStatus.PRESENT,
            ],
            2: [
                AttendanceStatus.LATE,
                AttendanceStatus.LATE,
                AttendanceStatus.ON_LEAVE,
                AttendanceStatus.PRESENT,
                AttendanceStatus.PRESENT,
            ],
        }
        with tenant_context(self.tenant.id):
            for index, statuses in plan.items():
                for offset, value in enumerate(statuses):
                    StudentAttendanceFactory(
                        tenant=self.tenant,
                        student=self.students[index],
                        section=self.section,
                        academic_session=self.session,
                        attendance_date=self.start + datetime.timedelta(days=offset),
                        status=value,
                        late_minutes=15 if value == AttendanceStatus.LATE else None,
                        marked_by=self.user.pk,
                    )

    def scoped(self):
        return StudentAttendance.objects.alive()


class StudentSummaryTests(ReportDataTestCase):
    def summary(self) -> dict:
        with tenant_context(self.tenant.id):
            rows = reports.student_summary(self.scoped(), start_date=self.start, end_date=self.end)
        return {row["student_id"]: row for row in rows}

    def test_a_full_attender_is_one_hundred_percent(self) -> None:
        self.assertEqual(self.summary()[self.students[0].pk]["attendance_rate"], Decimal("100.0"))

    def test_absences_reduce_the_rate(self) -> None:
        row = self.summary()[self.students[1].pk]

        self.assertEqual(row["absent_days"], 3)
        self.assertEqual(row["attendance_rate"], Decimal("40.0"))

    def test_approved_leave_is_excluded_from_the_denominator(self) -> None:
        """Counting a medical absence against a child would make it look like
        truancy — §13's rate is about unexplained absence."""
        row = self.summary()[self.students[2].pk]

        self.assertEqual(row["leave_days"], 1)
        self.assertEqual(row["counted_days"], 4)
        self.assertEqual(row["attendance_rate"], Decimal("100.0"))

    def test_a_late_arrival_still_counts_as_attendance(self) -> None:
        row = self.summary()[self.students[2].pk]

        self.assertEqual(row["late_days"], 2)
        self.assertEqual(row["present_days"], 4)

    def test_the_summary_is_one_query_regardless_of_roster_size(self) -> None:
        with tenant_context(self.tenant.id), self.assertNumQueries(1):
            reports.student_summary(self.scoped(), start_date=self.start, end_date=self.end)


class DefaulterTests(ReportDataTestCase):
    def defaulters(self, threshold=None):
        with tenant_context(self.tenant.id):
            return reports.defaulters(
                self.scoped(),
                start_date=self.start,
                end_date=self.end,
                threshold=threshold,
            )

    def test_only_students_below_the_threshold_are_listed(self) -> None:
        rows = self.defaulters()

        self.assertEqual([row["student_id"] for row in rows], [self.students[1].pk])

    def test_the_threshold_is_configurable(self) -> None:
        """Downwards, because the fixture's other two students are at exactly
        100% and "below 100" excludes them — a threshold that caught them would
        have to be `<=`, which would make every full attender a defaulter."""
        self.assertEqual(len(self.defaulters()), 1)

        self.assertEqual(len(self.defaulters(threshold=Decimal("30.0"))), 0)

    def test_a_student_with_no_counted_days_is_not_a_defaulter(self) -> None:
        """They were never expected — a mid-year admission, or a range that is
        all holidays. Listing them at 0% would be a false accusation."""
        with tenant_context(self.tenant.id):
            newcomer = self.students[0]
            StudentAttendance.objects.alive().filter(student=newcomer).delete()

        rows = self.defaulters(threshold=Decimal("100.0"))

        self.assertNotIn(newcomer.pk, [row["student_id"] for row in rows])


class DailyRegisterTests(ReportDataTestCase):
    def test_the_register_is_one_query_for_the_whole_section(self) -> None:
        with tenant_context(self.tenant.id), self.assertNumQueries(1):
            rows = reports.daily_register(self.scoped(), on_date=self.start)

        self.assertEqual(len(rows), 3)
        self.assertIn("admission_number", rows[0])


class LateArrivalTests(ReportDataTestCase):
    def test_lateness_is_counted_and_totalled(self) -> None:
        with tenant_context(self.tenant.id), self.assertNumQueries(1):
            rows = reports.student_late_arrivals(
                self.scoped(), start_date=self.start, end_date=self.end
            )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["late_count"], 2)
        self.assertEqual(rows[0]["total_late_minutes"], 30)


class StaffPunctualityTests(AttendanceAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()
        from apps.attendance.models import StaffAttendance

        with tenant_context(self.tenant.id):
            self.other_staff = StaffFactory(tenant=self.tenant, campus=self.campus)
            for offset, (staff, value, late) in enumerate(
                [
                    (self.teacher, StaffAttendanceStatus.PRESENT, None),
                    (self.teacher, StaffAttendanceStatus.LATE, 20),
                    (self.teacher, StaffAttendanceStatus.HOLIDAY, None),
                    (self.other_staff, StaffAttendanceStatus.ABSENT, None),
                ]
            ):
                StaffAttendance.objects.create(
                    tenant=self.tenant,
                    staff=staff,
                    attendance_date=MARKING_DATE - datetime.timedelta(days=offset),
                    status=value,
                    late_minutes=late,
                    marked_by=self.user.pk,
                )

    def test_holidays_are_excluded_from_every_count(self) -> None:
        """The school was shut; counting a closure against a teacher's
        punctuality is the mistake `holiday` exists to prevent."""
        from apps.attendance.models import StaffAttendance

        with tenant_context(self.tenant.id), self.assertNumQueries(1):
            rows = reports.staff_punctuality(
                StaffAttendance.objects.alive(),
                start_date=MARKING_DATE - datetime.timedelta(days=5),
                end_date=MARKING_DATE,
            )

        by_staff = {row["staff_id"]: row for row in rows}
        self.assertEqual(by_staff[self.teacher.pk]["working_days"], 2)
        self.assertEqual(by_staff[self.teacher.pk]["late_count"], 1)
        self.assertEqual(by_staff[self.teacher.pk]["total_late_minutes"], 20)
        self.assertEqual(by_staff[self.other_staff.pk]["absent_days"], 1)


class ReportEndpointTests(ReportDataTestCase):
    def test_a_small_report_comes_back_inline(self) -> None:
        response = self.client.get(
            f"{REPORTS}?kind=student-summary&start_date={self.start}&end_date={self.end}"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["meta"]["row_count"], 3)
        self.assertEqual(response.data["meta"]["kind"], "student-summary")

    def test_the_daily_register_needs_only_a_start_date(self) -> None:
        """A single-day report names one date; defaulting `end_date` means the
        register does not have to send the same date twice."""
        response = self.client.get(f"{REPORTS}?kind=daily-register&start_date={self.start}")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["data"]), 3)

    def test_an_unknown_kind_is_refused(self) -> None:
        response = self.client.get(f"{REPORTS}?kind=invented&start_date={self.start}")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_backwards_range_is_refused(self) -> None:
        response = self.client.get(
            f"{REPORTS}?kind=student-summary&start_date={self.end}&end_date={self.start}"
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_an_export_is_always_a_job(self) -> None:
        """§4 keys export separately, so it is a deliberate act with its own
        permission — not "the same report, but bigger"."""
        response = self.client.post(
            REPORTS,
            {
                "kind": "student-summary",
                "start_date": self.start.isoformat(),
                "end_date": self.end.isoformat(),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        self.assertIn("job_id", response.data["data"])

    def test_the_view_key_alone_cannot_export(self) -> None:
        reader = UserFactory(tenant=self.tenant)
        authenticate(self.client, reader)
        grant(reader, "attendance.report.view", scope=RecordScope.ALL)

        response = self.client.post(
            REPORTS,
            {"kind": "student-summary", "start_date": self.start.isoformat()},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_a_class_teacher_sees_only_their_assigned_sections(self) -> None:
        """§13's closing line: "all reports respect record scopes". A report is
        read as authoritative, which makes it the worst place to lose a scope."""
        authenticate(self.client, self.teacher_user)
        grant(
            self.teacher_user,
            "attendance.report.view",
            "attendance.student-attendance.view",
            scope=RecordScope.ASSIGNED,
        )

        response = self.client.get(
            f"{REPORTS}?kind=student-summary&start_date={self.start}&end_date={self.end}"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["meta"]["row_count"], 3)

    def test_a_restricted_principal_cannot_run_a_report(self) -> None:
        student_user = UserFactory(tenant=self.tenant)
        authenticate(self.client, student_user)
        grant(
            student_user,
            "attendance.report.view",
            scope=RecordScope.ALL,
            is_restricted_principal=True,
        )

        response = self.client.get(f"{REPORTS}?kind=student-summary&start_date={self.start}")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class ReportExportTaskTests(ReportDataTestCase):
    def test_the_export_writes_a_csv_and_finishes_the_job(self) -> None:
        from apps.attendance.tasks import export_attendance_report_task
        from core.jobs.models import BackgroundJob, JobStatus
        from core.jobs.services import create_job

        with tenant_context(self.tenant.id):
            job = create_job(
                tenant_id=self.tenant.pk,
                job_type="attendance.report-export",
                payload={
                    "kind": "student-summary",
                    "start_date": self.start.isoformat(),
                    "end_date": self.end.isoformat(),
                    "section_id": None,
                    "requested_by": str(self.user.pk),
                },
                actor_id=self.user.pk,
            )

        export_attendance_report_task(
            tenant_id=str(self.tenant.pk), job_id=str(job.pk), actor_id=str(self.user.pk)
        )

        with tenant_context(self.tenant.id):
            job = BackgroundJob.objects.get(pk=job.pk)
            self.assertEqual(job.status, JobStatus.SUCCEEDED)
            self.assertEqual(job.result["rows"], 3)
            self.assertIn("result_file_id", job.result)


class ReportRowCapTests(ReportDataTestCase):
    """The inline/job decision must not cost the query it is deciding about."""

    def test_a_limit_caps_what_is_materialised(self) -> None:
        with tenant_context(self.tenant.id):
            rows = reports.student_summary(
                self.scoped(), start_date=self.start, end_date=self.end, limit=2
            )

        self.assertEqual(len(rows), 2)

    def test_the_endpoint_asks_for_one_row_past_the_ceiling(self) -> None:
        """One row past the ceiling is all it takes to know, so the decision
        costs a bounded query rather than the term-scale one the job rebuilds."""
        from unittest import mock

        from apps.attendance import tasks

        real = tasks.build_report_rows
        seen = {}

        def record(**kwargs):
            seen.update(kwargs)
            return real(**kwargs)

        with mock.patch.object(tasks, "build_report_rows", side_effect=record):
            self.client.get(
                f"{REPORTS}?kind=student-summary&start_date={self.start}&end_date={self.end}"
            )

        self.assertEqual(seen["limit"], services.SYNCHRONOUS_REPORT_ROW_LIMIT + 1)

    def test_a_defaulter_cap_applies_to_the_filtered_set(self) -> None:
        """Capping the source would cap the wrong population — the first N
        students alphabetically rather than the first N defaulters."""
        with tenant_context(self.tenant.id):
            rows = reports.defaulters(
                self.scoped(), start_date=self.start, end_date=self.end, limit=5
            )

        self.assertEqual(len(rows), 1)
