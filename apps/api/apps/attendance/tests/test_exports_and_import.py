"""§6's export endpoint and §9's historical-register import.

The renderer itself moved to `core/exports/` when `examinations` became its
second caller, and its cases moved with it — what is left here is what is
actually attendance's: that the endpoint hands a large report to a job rather
than building it inline, and that an old register can be imported without being
mistaken for today's.
"""

from __future__ import annotations

import datetime

from django.utils import timezone
from rest_framework import status

from apps.attendance import services
from apps.attendance.models import (
    AttendanceSource,
    AttendanceStatus,
    StudentAttendance,
)
from apps.attendance.tests.base import AttendanceAPITestCase
from apps.attendance.tests.factories import (
    MARKING_DATE,
    StudentAttendanceFactory,
    UserFactory,
    authenticate,
    configure_academic,
    grant,
)
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

REPORTS = "/api/v1/reports/attendance-summary"
IMPORTS = "/api/v1/student-attendance-imports"


class ExportEndpointTests(AttendanceAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()
        grant(
            self.user,
            "attendance.report.view",
            "attendance.report.export",
            scope=RecordScope.ALL,
        )
        with tenant_context(self.tenant.id):
            StudentAttendanceFactory(
                tenant=self.tenant,
                student=self.students[0],
                section=self.section,
                academic_session=self.session,
                marked_by=self.user.pk,
            )

    def test_the_export_format_reaches_the_job_payload(self) -> None:
        response = self.client.post(
            REPORTS,
            {
                "kind": "student-summary",
                "start_date": MARKING_DATE.isoformat(),
                "format": "xlsx",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        with tenant_context(self.tenant.id):
            from core.jobs.models import BackgroundJob

            job = BackgroundJob.objects.get(pk=response.data["data"]["job_id"])
            self.assertEqual(job.payload["format"], "xlsx")

    def test_the_format_defaults_to_csv(self) -> None:
        response = self.client.post(
            REPORTS,
            {"kind": "student-summary", "start_date": MARKING_DATE.isoformat()},
            format="json",
        )

        with tenant_context(self.tenant.id):
            from core.jobs.models import BackgroundJob

            job = BackgroundJob.objects.get(pk=response.data["data"]["job_id"])
            self.assertEqual(job.payload["format"], "csv")

    def test_an_unknown_format_is_a_400(self) -> None:
        response = self.client.post(
            REPORTS,
            {
                "kind": "student-summary",
                "start_date": MARKING_DATE.isoformat(),
                "format": "docx",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_the_job_writes_the_requested_format(self) -> None:
        from apps.attendance.tasks import export_attendance_report_task
        from core.jobs.models import BackgroundJob, JobStatus
        from core.jobs.services import create_job

        with tenant_context(self.tenant.id):
            job = create_job(
                tenant_id=self.tenant.pk,
                job_type="attendance.report-export",
                payload={
                    "kind": "student-summary",
                    "start_date": MARKING_DATE.isoformat(),
                    "end_date": MARKING_DATE.isoformat(),
                    "section_id": None,
                    "format": "xlsx",
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
            self.assertEqual(job.result["format"], "xlsx")


class HistoricalImportTests(AttendanceAPITestCase):
    """§9's onboarding migration — and the three register rules it does not apply."""

    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()
        self.it_admin = UserFactory(tenant=self.tenant)
        grant(self.it_admin, "attendance.student-attendance.import", scope=RecordScope.ALL)
        self.last_year = timezone.localdate() - datetime.timedelta(days=200)

    def import_row(self, **overrides) -> dict | None:
        row = {
            "admission_number": self.students[0].admission_number,
            "attendance_date": self.last_year.isoformat(),
            "status": AttendanceStatus.ABSENT,
            "check_in_time": "",
            "check_out_time": "",
            "remarks": "",
            **overrides,
        }
        with tenant_context(self.tenant.id):
            return services.import_attendance_row(
                row=row,
                row_number=2,
                session=self.session,
                tenant_id=self.tenant.pk,
                actor_id=self.it_admin.pk,
            )

    def test_a_historical_row_is_written_locked_and_sourced_as_import(self) -> None:
        """A migrated register is not something a teacher edits at the register.
        `AttendanceSource.IMPORT` was declared and unreachable until now."""
        self.assertIsNone(self.import_row())

        with tenant_context(self.tenant.id):
            row = StudentAttendance.objects.alive().get(student=self.students[0])
            self.assertEqual(row.status, AttendanceStatus.ABSENT)
            self.assertEqual(row.source, AttendanceSource.IMPORT)
            self.assertTrue(row.is_locked)

    def test_a_date_todays_calendar_calls_a_holiday_still_imports(self) -> None:
        """The tenant's *current* calendar describes this year. A register from
        three years ago was kept against that year's, and refusing rows against
        today's would silently rewrite what the school's records say happened."""
        configure_academic(self.tenant, working_days=[5, 6])

        self.assertIsNone(self.import_row())

    def test_importing_never_alerts_a_guardian(self) -> None:
        """The most important of the three omissions: importing a year of history
        must not email a parent about an absence from last March."""
        from unittest import mock

        with (
            mock.patch("apps.attendance.tasks.send_attendance_alerts.delay") as queued,
            self.captureOnCommitCallbacks(execute=True),
        ):
            self.import_row()

        queued.assert_not_called()

    def test_a_future_date_is_still_refused(self) -> None:
        """Historical means historical — the one register rule that does apply."""
        error = self.import_row(
            attendance_date=(timezone.localdate() + datetime.timedelta(days=1)).isoformat()
        )

        self.assertEqual(error["field"], "attendance_date")

    def test_on_leave_cannot_be_imported(self) -> None:
        """It means an approved leave request exists, and an import has none to
        point at — the same rule the register and the correction flow enforce."""
        error = self.import_row(status=AttendanceStatus.ON_LEAVE)

        self.assertIn("excused", error["issue"])

    def test_an_unknown_admission_number_is_a_row_error_not_a_failure(self) -> None:
        error = self.import_row(admission_number="NOT-A-STUDENT")

        self.assertEqual(error["field"], "admission_number")
        self.assertEqual(error["row"], "2")

    def test_a_malformed_date_names_the_column(self) -> None:
        error = self.import_row(attendance_date="06/04/2026")

        self.assertEqual(error["field"], "attendance_date")

    def test_a_malformed_time_names_the_column(self) -> None:
        error = self.import_row(status=AttendanceStatus.LATE, check_in_time="quarter past eight")

        self.assertEqual(error["field"], "check_in_time")

    def test_a_missing_required_column_is_reported(self) -> None:
        error = self.import_row(status="")

        self.assertEqual(error["field"], "status")

    def test_re_importing_the_same_row_updates_rather_than_failing(self) -> None:
        """A migration is re-run after the error report is fixed, so the second
        pass must not collide with the first on the unique index."""
        self.import_row()
        self.assertIsNone(self.import_row(status=AttendanceStatus.PRESENT))

        with tenant_context(self.tenant.id):
            self.assertEqual(StudentAttendance.objects.alive().count(), 1)
            self.assertEqual(
                StudentAttendance.objects.alive().get().status, AttendanceStatus.PRESENT
            )


class ImportEndpointTests(AttendanceAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.it_admin = UserFactory(tenant=self.tenant)
        grant(self.it_admin, "attendance.student-attendance.import", scope=RecordScope.ALL)
        authenticate(self.client, self.it_admin)

    def upload(self, content: bytes = b"admission_number,attendance_date,status\n"):
        from django.core.files.uploadedfile import SimpleUploadedFile

        return self.client.post(
            IMPORTS,
            {
                "file": SimpleUploadedFile("register.csv", content, content_type="text/csv"),
                "academic_session_id": str(self.session.pk),
            },
            format="multipart",
        )

    def test_an_import_returns_a_job(self) -> None:
        response = self.upload()

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        self.assertIn("job_id", response.data["data"])

    def test_the_session_is_required_and_never_defaulted(self) -> None:
        """A historical register belongs to a *past* session by definition;
        falling back to "current" would file three years of history under this
        year and be almost impossible to unpick."""
        from django.core.files.uploadedfile import SimpleUploadedFile

        response = self.client.post(
            IMPORTS,
            {"file": SimpleUploadedFile("register.csv", b"a,b\n", content_type="text/csv")},
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_marking_role_cannot_import(self) -> None:
        """Giving the import key to `teacher` would make "rewrite any past
        register, bypassing the lock window and the correction workflow" a
        routine classroom permission."""
        teacher = UserFactory(tenant=self.tenant)
        authenticate(self.client, teacher)
        grant(teacher, "attendance.student-attendance.mark", scope=RecordScope.ALL)

        self.assertEqual(self.upload().status_code, status.HTTP_403_FORBIDDEN)

    def test_a_restricted_principal_cannot_import(self) -> None:
        guardian = UserFactory(tenant=self.tenant)
        authenticate(self.client, guardian)
        grant(
            guardian,
            "attendance.student-attendance.import",
            scope=RecordScope.ALL,
            is_restricted_principal=True,
        )

        self.assertEqual(self.upload().status_code, status.HTTP_403_FORBIDDEN)

    def test_an_oversized_file_is_refused(self) -> None:
        response = self.upload(content=b"x" * (10 * 1024 * 1024 + 1))

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)


class ImportOverwriteGuardTests(HistoricalImportTests):
    """The import upserts, so it can land on a row a human has already settled."""

    def test_a_locked_row_is_not_silently_overwritten(self) -> None:
        """A locked row belongs to the correction workflow. A migration
        rewriting one is worse than a line in the error report."""
        with tenant_context(self.tenant.id):
            StudentAttendanceFactory(
                tenant=self.tenant,
                student=self.students[0],
                section=self.section,
                academic_session=self.session,
                attendance_date=self.last_year,
                status=AttendanceStatus.PRESENT,
                marked_by=self.user.pk,
                source=AttendanceSource.MANUAL,
                is_locked=True,
            )

        error = self.import_row(status=AttendanceStatus.ABSENT)

        self.assertIn("correction request", error["issue"])
        with tenant_context(self.tenant.id):
            row = StudentAttendance.objects.alive().get(student=self.students[0])
            self.assertEqual(row.status, AttendanceStatus.PRESENT)

    def test_an_approved_leave_row_is_not_clobbered(self) -> None:
        """It belongs to a leave request that would be left pointing at a status
        it no longer describes — the same stale-link bug the register guards."""
        from apps.attendance.models import LeaveRequest, LeaveType, RequesterType

        with tenant_context(self.tenant.id):
            leave_type = LeaveType.objects.create(tenant=self.tenant, name="Sick", code="SICK-IMP")
            request = LeaveRequest.objects.create(
                tenant=self.tenant,
                requester_type=RequesterType.STUDENT,
                student=self.students[0],
                leave_type=leave_type,
                start_date=self.last_year,
                end_date=self.last_year,
                days_count=1,
                reason="Migrated leave.",
                submitted_by=self.user.pk,
            )
            StudentAttendanceFactory(
                tenant=self.tenant,
                student=self.students[0],
                section=self.section,
                academic_session=self.session,
                attendance_date=self.last_year,
                status=AttendanceStatus.ON_LEAVE,
                leave_request=request,
                marked_by=self.user.pk,
            )

        error = self.import_row(status=AttendanceStatus.ABSENT)

        self.assertIn("approved leave", error["issue"])
        with tenant_context(self.tenant.id):
            row = StudentAttendance.objects.alive().get(student=self.students[0])
            self.assertEqual(row.status, AttendanceStatus.ON_LEAVE)
            self.assertEqual(row.leave_request_id, request.pk)

    def test_the_import_can_re_import_its_own_locked_rows(self) -> None:
        """The control, and the reason the guard keys on `source` rather than on
        the lock alone: the import writes its own rows locked, so a bare
        locked-row refusal would block the re-run §9's journey depends on."""
        self.import_row()

        self.assertIsNone(self.import_row(status=AttendanceStatus.PRESENT))

        with tenant_context(self.tenant.id):
            row = StudentAttendance.objects.alive().get(student=self.students[0])
            self.assertEqual(row.status, AttendanceStatus.PRESENT)
            self.assertEqual(row.source, AttendanceSource.IMPORT)
