"""Tests for the staff-imports/-exports background jobs.

CELERY_TASK_ALWAYS_EAGER (config/settings/test.py) means `.delay()` runs the
task synchronously inside the request — by the time the HTTP response comes
back, the job has already reached its terminal state, so these tests just
refresh the job row from the database rather than polling. Mirrors
student_management/tests/test_import_export_idcards.py's identical pattern.
"""

from __future__ import annotations

import csv
import datetime
import io
from unittest import mock

from django.db import connection
from django.test import TransactionTestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import (
    CampusFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.staff_management.models import EmploymentStatus, Gender, Staff, StaffType
from apps.staff_management.staff.services.export_staff import build_staff_export_csv
from apps.staff_management.tests.factories import StaffFactory, enable_feature
from core.files.models import File
from core.jobs.models import BackgroundJob, JobStatus
from core.tenancy.context import tenant_atomic, tenant_context


class StaffManagementJobsAPITestCase(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)
        enable_feature(self.tenant, "module.staff")
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant, code="MAIN")

    def allow(self, *keys: str) -> None:
        grant(self.user, *keys)


class StaffImportTests(StaffManagementJobsAPITestCase):
    def _upload(self, content: str, filename: str = "staff.csv"):
        upload = io.BytesIO(content.encode())
        upload.name = filename
        return self.client.post("/api/v1/staff-imports", {"file": upload}, format="multipart")

    def test_imports_a_valid_row(self) -> None:
        self.allow("staff.staff.import")
        csv_content = (
            "first_name,last_name,staff_type,campus_code,joining_date,phone\n"
            "Amina,Khan,teaching,MAIN,2026-04-01,+923001234567\n"
        )

        response = self._upload(csv_content)

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        job_id = response.json()["data"]["job_id"]
        with tenant_context(self.tenant.id):
            job = BackgroundJob.objects.get(pk=job_id)
        self.assertEqual(job.status, JobStatus.SUCCEEDED)
        self.assertEqual(job.result["succeeded"], 1)
        self.assertEqual(job.result["failed"], 0)

    def test_records_a_row_level_error_for_a_missing_required_field_without_aborting_the_batch(
        self,
    ) -> None:
        self.allow("staff.staff.import")
        csv_content = (
            "first_name,last_name,staff_type,campus_code,joining_date,phone\n"
            "Amina,,teaching,MAIN,2026-04-01,+923001234567\n"
            "Bilal,Rahman,teaching,MAIN,2026-04-01,+923001234568\n"
        )

        response = self._upload(csv_content)

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        job_id = response.json()["data"]["job_id"]
        with tenant_context(self.tenant.id):
            job = BackgroundJob.objects.get(pk=job_id)
        self.assertEqual(job.result["failed"], 1)
        self.assertEqual(job.result["errors"][0]["field"], "last_name")
        # The second row's success is what proves the bad first row didn't abort the batch.
        self.assertEqual(job.result["succeeded"], 1)

    def test_rejects_an_oversized_file(self) -> None:
        self.allow("staff.staff.import")
        huge_content = "a" * (6 * 1024 * 1024)

        response = self._upload(huge_content)

        self.assertEqual(
            response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY, response.json()
        )

    def test_requires_the_import_permission(self) -> None:
        response = self._upload("first_name,last_name\n")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    HEADER = "first_name,last_name,staff_type,campus_code,joining_date,phone,gender,date_of_birth\n"

    def _result(self, content: str) -> dict:
        response = self._upload(content)
        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        with tenant_context(self.tenant.id):
            job = BackgroundJob.objects.get(pk=response.json()["data"]["job_id"])
        self.assertEqual(job.status, JobStatus.SUCCEEDED, job.error)
        return job.result

    def test_a_bad_date_of_birth_is_reported_against_date_of_birth(self) -> None:
        self.allow("staff.staff.import")
        result = self._result(
            self.HEADER + "Amina,Khan,teaching,MAIN,2026-04-01,+923001234567,female,01/02/1990\n"
        )
        self.assertEqual(result["errors"][0]["field"], "date_of_birth")

    def test_a_bad_joining_date_is_reported_against_joining_date(self) -> None:
        self.allow("staff.staff.import")
        result = self._result(
            self.HEADER + "Amina,Khan,teaching,MAIN,01/04/2026,+923001234567,female,1990-02-01\n"
        )
        self.assertEqual(result["errors"][0]["field"], "joining_date")

    def test_rejects_a_gender_outside_the_choices(self) -> None:
        self.allow("staff.staff.import")
        result = self._result(
            self.HEADER + "Amina,Khan,teaching,MAIN,2026-04-01,+923001234567,f,1990-02-01\n"
        )
        self.assertEqual(result["errors"][0]["field"], "gender")
        with tenant_context(self.tenant.id):
            self.assertFalse(Staff.objects.filter(first_name="Amina").exists())

    def test_accepts_gender_case_insensitively_and_stores_it_lowercase(self) -> None:
        self.allow("staff.staff.import")
        self._result(
            self.HEADER + "Amina,Khan,teaching,MAIN,2026-04-01,+923001234567,Female,1990-02-01\n"
        )
        with tenant_context(self.tenant.id):
            self.assertEqual(Staff.objects.get(first_name="Amina").gender, Gender.FEMALE)

    def test_an_over_length_value_fails_only_its_row(self) -> None:
        self.allow("staff.staff.import")
        result = self._result(
            self.HEADER
            + f"{'A' * 101},Khan,teaching,MAIN,2026-04-01,+923001234567,female,1990-02-01\n"
            + "Bilal,Rahman,teaching,MAIN,2026-04-01,+923001234568,male,1990-02-01\n"
        )
        self.assertEqual((result["succeeded"], result["errors"][0]["field"]), (1, "first_name"))

    def test_an_unknown_campus_code_is_reported_without_aborting_the_batch(self) -> None:
        self.allow("staff.staff.import")
        result = self._result(
            self.HEADER
            + "Amina,Khan,teaching,NOPE,2026-04-01,+923001234567,female,1990-02-01\n"
            + "Bilal,Rahman,teaching,MAIN,2026-04-01,+923001234568,male,1990-02-01\n"
        )
        self.assertEqual((result["succeeded"], result["errors"][0]["field"]), (1, "campus_code"))
        self.assertIn("NOPE", result["errors"][0]["issue"])

    def test_a_soft_deleted_campus_code_is_not_matched(self) -> None:
        self.allow("staff.staff.import")
        with tenant_context(self.tenant.id):
            CampusFactory(tenant=self.tenant, code="OLD", deleted_at=timezone.now())
        result = self._result(
            self.HEADER + "Amina,Khan,teaching,OLD,2026-04-01,+923001234567,female,1990-02-01\n"
        )
        self.assertEqual(result["errors"][0]["field"], "campus_code")

    def test_progress_is_written_in_steps_not_per_row_and_ends_at_100(self) -> None:
        from core.jobs import services as job_services

        self.allow("staff.staff.import")
        rows = "".join(
            f"Person{i},Khan,teaching,MAIN,2026-04-01,+9230012345{i:02d},female,1990-02-01\n"
            for i in range(40)
        )

        with mock.patch.object(
            job_services, "update_progress", wraps=job_services.update_progress
        ) as spy:
            result = self._result(self.HEADER + rows)

        self.assertEqual(result["succeeded"], 40)
        self.assertLess(spy.call_count, 40)
        self.assertEqual(spy.call_args.kwargs["progress"], 100)

    def test_a_misspelled_header_fails_the_job_with_one_readable_error(self) -> None:
        self.allow("staff.staff.import")
        response = self._upload(
            "First Name,last_name,staff_type,campus_code,joining_date,phone\n"
            "Amina,Khan,teaching,MAIN,2026-04-01,+923001234567\n"
        )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        with tenant_context(self.tenant.id):
            job = BackgroundJob.objects.get(pk=response.json()["data"]["job_id"])
        self.assertEqual(job.status, JobStatus.FAILED)
        self.assertIn("first_name", job.error)


class StaffExportTests(StaffManagementJobsAPITestCase):
    def test_exports_staff_to_a_ready_file(self) -> None:
        self.allow("staff.staff.export")
        with tenant_context(self.tenant.id):
            StaffFactory(tenant=self.tenant, campus=self.campus)

        response = self.client.post("/api/v1/staff-exports")

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        job_id = response.json()["data"]["job_id"]
        with tenant_context(self.tenant.id):
            job = BackgroundJob.objects.get(pk=job_id)
            self.assertEqual(job.status, JobStatus.SUCCEEDED)
            file = File.objects.get(pk=job.result["result_file_id"])
        self.assertEqual(file.status, "ready")
        self.assertEqual(file.purpose, "staff.export")

    def test_requires_the_export_permission(self) -> None:
        response = self.client.post("/api/v1/staff-exports")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_csv_rows_are_ordered_by_last_then_first_name_and_carry_every_column(self) -> None:
        """Pins `build_staff_export_csv`'s switch from `list(...)` to `.iterator()`
        (streaming rows from the DB cursor instead of materializing the whole
        queryset) — asserts every column's real value, and that a soft-deleted
        row never appears, so dropping `select_related`/`.alive()` in a later
        edit would be caught here rather than in production."""
        with tenant_context(self.tenant.id):
            east_campus = CampusFactory(tenant=self.tenant, code="EAST")
            StaffFactory(
                tenant=self.tenant,
                campus=self.campus,
                employee_number="EXP-0001",
                first_name="Zara",
                last_name="Ahmed",
                staff_type=StaffType.TEACHING,
                employment_status=EmploymentStatus.ACTIVE,
                joining_date=datetime.date(2024, 1, 15),
            )
            StaffFactory(
                tenant=self.tenant,
                campus=east_campus,
                employee_number="EXP-0002",
                first_name="Ayesha",
                last_name="Khan",
                staff_type=StaffType.NON_TEACHING,
                employment_status=EmploymentStatus.ON_LEAVE,
                joining_date=datetime.date(2024, 3, 1),
            )
            departed = StaffFactory(
                tenant=self.tenant,
                campus=self.campus,
                employee_number="EXP-9999",
                first_name="Departed",
                last_name="Zzz",
            )
            Staff.objects.filter(pk=departed.pk).update(deleted_at=timezone.now())

        csv_bytes = build_staff_export_csv(tenant_id=self.tenant.id)

        rows = list(csv.reader(io.StringIO(csv_bytes.decode("utf-8"))))
        self.assertEqual(
            rows[0],
            [
                "employee_number",
                "first_name",
                "last_name",
                "staff_type",
                "campus_code",
                "employment_status",
                "joining_date",
            ],
        )
        # "Ahmed" sorts before "Khan" — proves ordering survived the switch to a
        # streamed cursor, not just that both rows are present somewhere.
        self.assertEqual(
            rows[1],
            ["EXP-0001", "Zara", "Ahmed", "teaching", "MAIN", "active", "2024-01-15"],
        )
        self.assertEqual(
            rows[2],
            ["EXP-0002", "Ayesha", "Khan", "non_teaching", "EAST", "on_leave", "2024-03-01"],
        )
        # The soft-deleted row must never appear — proves `.alive()` survived the switch.
        self.assertEqual(len(rows), 3)

    def test_query_count_does_not_grow_with_row_count(self) -> None:
        """Guards `select_related("campus")`: drop it and each row's campus
        becomes its own query, so the count grows with the row count instead of
        staying fixed. Compares two runs rather than asserting a literal number,
        so it isn't brittle against `tenant_atomic`'s own query count."""
        with tenant_context(self.tenant.id):
            for i in range(2):
                StaffFactory(tenant=self.tenant, campus=self.campus, employee_number=f"EXP-Q{i}")
        with CaptureQueriesContext(connection) as small:
            build_staff_export_csv(tenant_id=self.tenant.id)

        with tenant_context(self.tenant.id):
            for i in range(2, 7):
                StaffFactory(tenant=self.tenant, campus=self.campus, employee_number=f"EXP-Q{i}")
        with CaptureQueriesContext(connection) as larger:
            build_staff_export_csv(tenant_id=self.tenant.id)

        self.assertEqual(len(small.captured_queries), len(larger.captured_queries))

    def test_a_formula_shaped_name_is_neutralised(self) -> None:
        with tenant_context(self.tenant.id):
            StaffFactory(tenant=self.tenant, campus=self.campus, first_name="@SUM(A1)")

        csv_bytes = build_staff_export_csv(tenant_id=self.tenant.id)

        rows = list(csv.reader(io.StringIO(csv_bytes.decode("utf-8"))))
        self.assertEqual(rows[1][1], "'@SUM(A1)")


class StaffExportStandaloneTests(TransactionTestCase):
    """`build_staff_export_csv`'s cursor loop must run *inside* `tenant_atomic`
    (see that function's own comment) — but `StaffExportTests` above is an
    `APITestCase`, which wraps the whole test body in one outer transaction, so
    `SET LOCAL`'s scope is that whole transaction regardless of how many nested
    `tenant_atomic` calls run inside it. A version of the builder with the loop
    moved outside `tenant_atomic` would still pass every test above, because the
    GUC set by the outer test transaction is still visible. `TransactionTestCase`
    runs each test in a real, independent, unwrapped transaction — the same
    shape a Celery task actually runs in — so it's the only lane that would
    catch that regression. Mirrors
    core/jobs/tests/test_job_progress_visibility.py's identical reasoning."""

    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        with tenant_atomic(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant, code="MAIN")
            StaffFactory(tenant=self.tenant, campus=self.campus, employee_number="EXP-0001")

    def test_exported_rows_are_visible_from_their_own_standalone_transaction(self) -> None:
        csv_bytes = build_staff_export_csv(tenant_id=self.tenant.id)

        rows = list(csv.reader(io.StringIO(csv_bytes.decode("utf-8"))))
        self.assertEqual(len(rows), 2)  # header + the one staff row
