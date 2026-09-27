"""Tests for the staff-imports/-exports background jobs.

CELERY_TASK_ALWAYS_EAGER (config/settings/test.py) means `.delay()` runs the
task synchronously inside the request — by the time the HTTP response comes
back, the job has already reached its terminal state, so these tests just
refresh the job row from the database rather than polling. Mirrors
student_management/tests/test_import_export_idcards.py's identical pattern.
"""

from __future__ import annotations

import csv
import io

from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import (
    CampusFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.staff_management.staff.services.export_staff import build_staff_export_csv
from apps.staff_management.tests.factories import StaffFactory, enable_feature
from core.files.models import File
from core.jobs.models import BackgroundJob, JobStatus
from core.tenancy.context import tenant_context


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
        queryset) — real multi-row content, decoded back from the CSV bytes, is
        the only practical way to prove that change didn't silently drop or
        misorder a row."""
        with tenant_context(self.tenant.id):
            StaffFactory(
                tenant=self.tenant,
                campus=self.campus,
                employee_number="TEST-0001",
                first_name="Zara",
                last_name="Ahmed",
            )
            StaffFactory(
                tenant=self.tenant,
                campus=self.campus,
                employee_number="TEST-0002",
                first_name="Ayesha",
                last_name="Khan",
            )

        csv_bytes = build_staff_export_csv(tenant_id=self.tenant.id)

        rows = list(csv.reader(io.StringIO(csv_bytes.decode("utf-8"))))
        self.assertEqual(
            rows[0],
            ["employee_number", "first_name", "last_name", "staff_type", "campus_code",
             "employment_status", "joining_date"],
        )
        # "Ahmed" sorts before "Khan" — proves ordering survived the switch to a
        # streamed cursor, not just that both rows are present somewhere.
        self.assertEqual(rows[1][:3], ["TEST-0001", "Zara", "Ahmed"])
        self.assertEqual(rows[2][:3], ["TEST-0002", "Ayesha", "Khan"])
        self.assertEqual(len(rows), 3)
