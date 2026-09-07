"""Tests for the student-imports/-exports/id-cards:generate background jobs.

CELERY_TASK_ALWAYS_EAGER (config/settings/test.py) means `.delay()` runs the
task synchronously inside the request — by the time the HTTP response comes
back, the job has already reached its terminal state, so these tests just
refresh the job row from the database rather than polling.
"""

from __future__ import annotations

import io
from unittest.mock import patch

from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import (
    CampusFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.student_management import services
from apps.student_management.tests.factories import StudentFactory, enable_feature
from core.files.models import File
from core.jobs.models import BackgroundJob, JobStatus
from core.tenancy.context import tenant_context


class StudentManagementJobsAPITestCase(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)
        enable_feature(self.tenant, "module.students")
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant, code="MAIN")

    def allow(self, *keys: str) -> None:
        grant(self.user, *keys)


class StudentImportTests(StudentManagementJobsAPITestCase):
    def _upload(self, content: str, filename: str = "students.csv"):
        upload = io.BytesIO(content.encode())
        upload.name = filename
        return self.client.post("/api/v1/student-imports", {"file": upload}, format="multipart")

    def test_imports_a_valid_row(self) -> None:
        self.allow("students.student.import")
        csv_content = (
            "first_name,last_name,date_of_birth,gender,campus_code,admission_date\n"
            "Amina,Khan,2015-06-01,female,MAIN,2026-04-01\n"
        )

        response = self._upload(csv_content)

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        job_id = response.json()["data"]["job_id"]
        with tenant_context(self.tenant.id):
            job = BackgroundJob.objects.get(pk=job_id)
        self.assertEqual(job.status, JobStatus.SUCCEEDED)
        self.assertEqual(job.result["succeeded"], 1)
        self.assertEqual(job.result["failed"], 0)

    def test_records_a_row_level_error_for_an_unknown_campus(self) -> None:
        self.allow("students.student.import")
        csv_content = (
            "first_name,last_name,date_of_birth,gender,campus_code,admission_date\n"
            "Amina,Khan,2015-06-01,female,NOPE,2026-04-01\n"
        )

        response = self._upload(csv_content)

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        job_id = response.json()["data"]["job_id"]
        with tenant_context(self.tenant.id):
            job = BackgroundJob.objects.get(pk=job_id)
        self.assertEqual(job.status, JobStatus.SUCCEEDED)
        self.assertEqual(job.result["failed"], 1)
        self.assertEqual(job.result["errors"][0]["field"], "campus_code")

    def test_records_a_row_level_error_for_a_missing_required_field(self) -> None:
        self.allow("students.student.import")
        csv_content = (
            "first_name,last_name,date_of_birth,gender,campus_code,admission_date\n"
            "Amina,,2015-06-01,female,MAIN,2026-04-01\n"
        )

        response = self._upload(csv_content)

        job_id = response.json()["data"]["job_id"]
        with tenant_context(self.tenant.id):
            job = BackgroundJob.objects.get(pk=job_id)
        self.assertEqual(job.result["failed"], 1)
        self.assertEqual(job.result["errors"][0]["field"], "last_name")

    def test_a_second_row_still_imports_after_the_first_fails(self) -> None:
        self.allow("students.student.import")
        csv_content = (
            "first_name,last_name,date_of_birth,gender,campus_code,admission_date\n"
            "Amina,,2015-06-01,female,MAIN,2026-04-01\n"
            "Bilal,Rahman,2014-01-15,male,MAIN,2026-04-01\n"
        )

        response = self._upload(csv_content)

        job_id = response.json()["data"]["job_id"]
        with tenant_context(self.tenant.id):
            job = BackgroundJob.objects.get(pk=job_id)
        self.assertEqual(job.result["succeeded"], 1)
        self.assertEqual(job.result["failed"], 1)

    def test_rejects_an_oversized_file(self) -> None:
        self.allow("students.student.import")
        huge_content = "a" * (6 * 1024 * 1024)

        response = self._upload(huge_content)

        self.assertEqual(
            response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY, response.json()
        )

    def test_requires_the_import_permission(self) -> None:
        response = self._upload("first_name,last_name\n")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class StudentExportTests(StudentManagementJobsAPITestCase):
    def test_exports_students_to_a_ready_file(self) -> None:
        self.allow("students.student.export")
        with tenant_context(self.tenant.id):
            StudentFactory(tenant=self.tenant, campus=self.campus)

        response = self.client.post("/api/v1/student-exports")

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        job_id = response.json()["data"]["job_id"]
        with tenant_context(self.tenant.id):
            job = BackgroundJob.objects.get(pk=job_id)
            self.assertEqual(job.status, JobStatus.SUCCEEDED)
            file = File.objects.get(pk=job.result["result_file_id"])
        self.assertEqual(file.status, "ready")
        self.assertEqual(file.purpose, "student.export")

    def test_requires_the_export_permission(self) -> None:
        response = self.client.post("/api/v1/student-exports")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class IdCardGenerateTests(StudentManagementJobsAPITestCase):
    def test_generates_a_merged_pdf_for_the_selected_students(self) -> None:
        self.allow("students.id-card.generate")
        with tenant_context(self.tenant.id):
            student = StudentFactory(tenant=self.tenant, campus=self.campus)

        response = self.client.post(
            "/api/v1/id-cards:generate", {"student_ids": [str(student.pk)]}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        job_id = response.json()["data"]["job_id"]
        with tenant_context(self.tenant.id):
            job = BackgroundJob.objects.get(pk=job_id)
            self.assertEqual(job.status, JobStatus.SUCCEEDED)
            file = File.objects.get(pk=job.result["result_file_id"])
        self.assertEqual(file.mime_type, "application/pdf")
        self.assertEqual(job.result["count"], 1)

    def test_reports_only_the_actually_rendered_count(self) -> None:
        self.allow("students.id-card.generate")
        with tenant_context(self.tenant.id):
            student = StudentFactory(tenant=self.tenant, campus=self.campus)
        missing_id = "00000000-0000-0000-0000-000000000000"

        response = self.client.post(
            "/api/v1/id-cards:generate",
            {"student_ids": [str(student.pk), missing_id]},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        job_id = response.json()["data"]["job_id"]
        with tenant_context(self.tenant.id):
            job = BackgroundJob.objects.get(pk=job_id)
        self.assertEqual(job.status, JobStatus.SUCCEEDED)
        # Two ids were requested, but only one resolves to a real student — the
        # reported count must reflect what was actually rendered, not the input size.
        self.assertEqual(job.result["count"], 1)

    def test_requires_at_least_one_student_id(self) -> None:
        self.allow("students.id-card.generate")

        response = self.client.post("/api/v1/id-cards:generate", {"student_ids": []}, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_requires_the_generate_permission(self) -> None:
        response = self.client.post("/api/v1/id-cards:generate", {"student_ids": []}, format="json")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_a_name_containing_markup_does_not_rewrite_the_card(self) -> None:
        """The renderer f-string'd names straight into its template.

        A pupil recorded as `O'Brien & Sons` produced a card with a broken
        heading, and one whose surname contained a tag rewrote the layout —
        which on an ID card is a document that no longer says what it claims.
        Escaping is now `core.documents.html`'s, which has no way to opt out.
        """
        self.allow("students.id-card.generate")
        with tenant_context(self.tenant.id):
            student = StudentFactory(
                tenant=self.tenant,
                campus=self.campus,
                first_name="Ayesha",
                last_name="<b>O'Brien</b> & Sons",
            )

        # The HTML is captured rather than the PDF inspected: WeasyPrint renders
        # broken markup happily, so a PDF that came back is not evidence the
        # name was escaped. What the renderer was *handed* is.
        with patch("core.documents.render_pdf", return_value=b"%PDF-stub") as render:
            _, count = services.render_id_cards_pdf(
                student_ids=[student.pk], tenant_id=self.tenant.pk
            )

        self.assertEqual(count, 1)
        document = render.call_args.args[0]
        self.assertNotIn("<b>O", document)
        self.assertIn("&lt;b&gt;O&#x27;Brien&lt;/b&gt; &amp; Sons", document)
