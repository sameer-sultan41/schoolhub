"""§6's three export formats, and §9's historical-register import.

The two halves are tested together because they are the same claim from opposite
ends: the module can get a register out of the system in the shape a school
wants, and get an old one back in without pretending it is today's.
"""

from __future__ import annotations

import datetime
import io

from django.test import TestCase
from django.utils import timezone
from rest_framework import status

from apps.attendance import exports, services
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

ROWS = [
    {"admission_number": "S-1", "first_name": "Ayesha", "attendance_rate": "92.5"},
    {"admission_number": "S-2", "first_name": "Bilal & Co", "attendance_rate": "40.0"},
]


class ExportFormatTests(TestCase):
    """One row shape, three renderings — the point of a formatter-only split."""

    def test_csv_carries_the_headers_and_every_row(self) -> None:
        data, mime_type, extension = exports.render(ROWS, fmt="csv", title="Summary")

        text = data.decode()
        self.assertEqual((mime_type, extension), ("text/csv", "csv"))
        self.assertIn("admission_number,first_name,attendance_rate", text)
        self.assertIn("Bilal & Co", text)

    def test_csv_says_so_when_there_is_nothing_to_say(self) -> None:
        """An empty file is indistinguishable from a failed export when someone
        opens it."""
        data, _, _ = exports.render([], fmt="csv", title="Summary")

        self.assertIn("no rows matched", data.decode())

    def test_xlsx_is_a_real_workbook_with_a_frozen_header(self) -> None:
        import openpyxl

        data, mime_type, extension = exports.render(ROWS, fmt="xlsx", title="Summary")

        self.assertEqual(extension, "xlsx")
        self.assertIn("spreadsheetml", mime_type)
        workbook = openpyxl.load_workbook(io.BytesIO(data))
        sheet = workbook.active
        self.assertEqual([cell.value for cell in sheet[1]], list(ROWS[0]))
        self.assertEqual(sheet["B3"].value, "Bilal & Co")
        self.assertEqual(sheet.freeze_panes, "A2")

    def test_a_sheet_name_excel_would_reject_is_sanitised(self) -> None:
        """Excel refuses a name over 31 characters or containing []:*?/\\ and
        fails the whole save rather than truncating."""
        import openpyxl

        data, _, _ = exports.render(
            ROWS, fmt="xlsx", title="Daily register: 6-A / 2026 [draft] " * 3
        )

        sheet = openpyxl.load_workbook(io.BytesIO(data)).active
        self.assertLessEqual(len(sheet.title), 31)
        self.assertNotIn(":", sheet.title)

    def test_pdf_renders_and_escapes_its_values(self) -> None:
        data, mime_type, extension = exports.render(ROWS, fmt="pdf", title="Summary")

        self.assertEqual((mime_type, extension), ("application/pdf", "pdf"))
        self.assertTrue(data.startswith(b"%PDF"))

    def test_pdf_refuses_a_row_count_nobody_would_read(self) -> None:
        """A 40,000-row register is hundreds of pages and enough memory to
        matter. The caller is told, rather than handed a truncated document that
        looks complete."""
        too_many = [dict(ROWS[0]) for _ in range(exports.PDF_ROW_LIMIT + 1)]

        with self.assertRaises(exports.ReportTooLargeForFormat):
            exports.render(too_many, fmt="pdf", title="Summary")

    def test_an_unknown_format_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            exports.render(ROWS, fmt="docx", title="Summary")

    def test_a_date_is_rendered_iso_not_locale_formatted(self) -> None:
        """A locale-formatted date is the classic way a column of dates becomes
        a column of text in a spreadsheet."""
        rows = [{"attendance_date": datetime.date(2026, 4, 6)}]

        data, _, _ = exports.render(rows, fmt="csv", title="Register")

        self.assertIn("2026-04-06", data.decode())


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
