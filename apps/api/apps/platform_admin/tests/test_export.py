"""`:export`: a full export of one school, as a job the school owns (platform-admin.md §5)."""

from __future__ import annotations

import csv
import io
import zipfile
from datetime import timedelta
from unittest import mock

from django.apps import apps as django_apps
from django.conf import settings
from django.db import models
from django.utils import timezone
from rest_framework import status

from apps.platform_admin.constants import TENANT_EXPORT_JOB_TYPE
from apps.platform_admin.export.services import EXPORT_DENIED_FIELDS
from apps.platform_admin.export.tasks import export_tenant
from apps.platform_admin.tests.base import (
    PlatformAPITestCase,
    bearer,
    make_tenant,
    platform_user,
    tenant_url,
)
from apps.platform_admin.tests.test_usage import populate
from apps.platform_admin.uploads import TENANT_EXPORT
from apps.school_organization.tests.factories import UserFactory, grant
from apps.staff_management.models import EmploymentStatus, Staff
from apps.student_management.models import Student, StudentStatus
from core.audit.models import AuditLog
from core.files.models import File
from core.files.storage import NullPresigner
from core.files.tests.factories import FileFactory
from core.jobs.models import BackgroundJob, JobStatus
from core.tenancy.context import tenant_context
from core.tenancy.models import Tenant, TenantStatus
from core.tenancy.rls import tenant_owned_tables

S = TenantStatus


def jobs_url(tenant: Tenant, job_id) -> str:
    return tenant_url(tenant, f"/jobs/{job_id}")


def download_url(tenant: Tenant, job_id) -> str:
    return tenant_url(tenant, f"/jobs/{job_id}:download")


#: Credentials and secrets: never portable data, so no export carries them (user ruling).
CREDENTIAL_FIELDS = {
    "password",
    "token",
    "refresh",
    "access",
    "secret",
    "api_key",
    "otp",
    "cvv",
    "token_hash",
    "mfa_secret",
    "code_hash",
    "credentials_ciphertext",
    "callback_token",
}


class ExportTests(PlatformAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.archives: list[bytes] = []
        patcher = mock.patch.object(NullPresigner, "put", autospec=True, side_effect=self._keep)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _keep(self, _presigner, *, storage_key: str, data, content_type: str) -> None:
        self.archives.append(data if isinstance(data, bytes) else data.read())

    def export(self, tenant: Tenant, **headers):
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(tenant_url(tenant, ":export"), **headers)

    def archive(self) -> zipfile.ZipFile:
        self.assertEqual(len(self.archives), 1)
        return zipfile.ZipFile(io.BytesIO(self.archives[0]))

    @staticmethod
    def rows(archive: zipfile.ZipFile, table: str) -> list[dict]:
        text = archive.read(f"data/{table}.csv").decode("utf-8")
        return list(csv.DictReader(io.StringIO(text)))

    def test_export_returns_a_job_the_target_school_owns(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)

        response = self.export(tenant)

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.content)
        job_id = response.json()["data"]["job_id"]
        with tenant_context(tenant.pk):
            job = BackgroundJob.objects.get(pk=job_id)
        self.assertEqual(job.tenant_id, tenant.pk)
        self.assertEqual(job.job_type, TENANT_EXPORT_JOB_TYPE)
        self.assertEqual(job.status, JobStatus.SUCCEEDED, job.error)
        with tenant_context(tenant.pk):
            file = File.objects.get(pk=job.result["result_file_id"])
        self.assertEqual(file.purpose, TENANT_EXPORT.key)
        self.assertEqual(file.mime_type, "application/zip")
        self.assertTrue(file.storage_key.startswith(f"tenants/{tenant.pk}/"))

    def test_export_contains_only_target_tenant_rows(self) -> None:
        target, other = make_tenant(status=S.ACTIVE), make_tenant(status=S.ACTIVE)
        populate(target, students=[StudentStatus.ACTIVE, StudentStatus.WITHDRAWN], files=[10])
        populate(other, students=[StudentStatus.ACTIVE], files=[20])
        mine = UserFactory(tenant=target, email="mine@target.test")
        UserFactory(tenant=other, email="theirs@other.test")
        grant(mine, "platform.job.view")

        self.export(target)

        archive = self.archive()
        names = set(archive.namelist())
        for table in (*tenant_owned_tables(), "users", "user_roles"):
            self.assertIn(f"data/{table}.csv", names)
        students = self.rows(archive, "students")
        self.assertEqual(len(students), 2)
        with tenant_context(other.pk):
            theirs = {str(pk) for pk in Student.objects.values_list("pk", flat=True)}
        for table in tenant_owned_tables():
            for row in self.rows(archive, table):
                self.assertEqual(row["tenant_id"], str(target.pk), table)
                self.assertNotIn(row.get("id"), theirs, table)
        emails = {row["email"] for row in self.rows(archive, "users")}
        self.assertIn("mine@target.test", emails)
        self.assertNotIn("theirs@other.test", emails)
        self.assertNotIn(self.operator.email, emails)
        self.assertEqual(
            {row["user_id"] for row in self.rows(archive, "user_roles")}, {str(mine.pk)}
        )
        # The school's stored files ride along under files/, its own only.
        with tenant_context(target.pk):
            stored = File.objects.exclude(purpose=TENANT_EXPORT.key).get()
        self.assertIn(f"files/{stored.pk}-{stored.original_name}", names)
        self.assertEqual(len([name for name in names if name.startswith("files/")]), 1)

    def test_export_leaves_out_earlier_exports(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)
        with tenant_context(tenant.pk):
            FileFactory(tenant=tenant, purpose=TENANT_EXPORT.key, mime_type="application/zip")

        self.export(tenant)

        self.assertFalse([name for name in self.archive().namelist() if name.startswith("files/")])

    def test_export_omits_secrets(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)
        user = UserFactory(tenant=tenant)
        user.mfa_secret = b"encrypted-totp-secret"
        user.save(update_fields=["mfa_secret"])

        self.export(tenant)

        self.assertEqual(EXPORT_DENIED_FIELDS, CREDENTIAL_FIELDS)
        archive = self.archive()
        binary_columns = {
            field.attname
            for model in django_apps.get_models()
            for field in model._meta.concrete_fields
            if isinstance(field, models.BinaryField)
        }
        for name in archive.namelist():
            if not name.startswith("data/"):
                continue
            header = next(csv.reader(io.StringIO(archive.read(name).decode("utf-8"))))
            with self.subTest(table=name):
                self.assertFalse(set(header) & EXPORT_DENIED_FIELDS, header)
                self.assertFalse(set(header) & binary_columns, header)
        users = archive.read("data/users.csv").decode("utf-8")
        self.assertNotIn(user.password, users)
        self.assertNotIn("encrypted-totp-secret", users)

    def test_export_keeps_the_school_s_personal_records(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)
        populate(tenant, students=[StudentStatus.ACTIVE], staff=[EmploymentStatus.ACTIVE])
        with tenant_context(tenant.pk):
            Student.objects.update(medical_notes="Asthma")
            Staff.objects.update(national_id="35202-1234567-1")

        self.export(tenant)

        archive = self.archive()
        # The school owns these; the archive is protected by gating and an audited download.
        (student,) = self.rows(archive, "students")
        self.assertEqual(student["medical_notes"], "Asthma")
        (staff,) = self.rows(archive, "staff")
        self.assertEqual(staff["national_id"], "35202-1234567-1")
        self.assertFalse(
            {"national_id", "medical_notes", "bank_account", "iban", "photo_url"}
            & EXPORT_DENIED_FIELDS
        )

    def test_poll_returns_the_job_without_a_link(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)
        job_id = self.export(tenant).json()["data"]["job_id"]

        response = self.client.get(jobs_url(tenant, job_id))

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        data = response.json()["data"]
        self.assertEqual(data["id"], job_id)
        self.assertEqual(data["job_type"], TENANT_EXPORT_JOB_TYPE)
        self.assertEqual(data["status"], JobStatus.SUCCEEDED)
        # A link is minted only by the audited `:download`.
        self.assertNotIn("download_url", data)

    def test_download_mints_a_link_and_audits_who_took_which_job(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)
        job_id = self.export(tenant).json()["data"]["job_id"]
        with tenant_context(tenant.pk):
            file_id = BackgroundJob.objects.get(pk=job_id).result["result_file_id"]

        response = self.client.post(download_url(tenant, job_id))

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        data = response.json()["data"]
        self.assertIn(f"tenants/{tenant.pk}/", data["download_url"])
        self.assertEqual(data["expires_in"], 300)
        row = AuditLog.objects.get(action="export_download")
        self.assertEqual(row.tenant_id, tenant.pk)
        self.assertEqual(row.actor_id, self.operator.pk)
        self.assertEqual(row.after["job_id"], job_id)
        self.assertEqual(row.after["file_id"], file_id)

        # Each download is its own audited event.
        self.client.post(download_url(tenant, job_id))
        self.assertEqual(AuditLog.objects.filter(action="export_download").count(), 2)

    def test_download_before_success_is_409_and_unaudited(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)
        with tenant_context(tenant.pk):
            running = BackgroundJob.objects.create(
                tenant=tenant, job_type=TENANT_EXPORT_JOB_TYPE, status=JobStatus.RUNNING
            )

        response = self.client.post(download_url(tenant, running.pk))

        self.assert_error(response, status.HTTP_409_CONFLICT, "conflict")
        self.assertFalse(AuditLog.objects.filter(action="export_download").exists())

    def test_download_of_another_school_s_job_404(self) -> None:
        mine, theirs = make_tenant(status=S.ACTIVE), make_tenant(status=S.ACTIVE)
        job_id = self.export(theirs).json()["data"]["job_id"]

        response = self.client.post(download_url(mine, job_id))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.sign_in_as(platform_user("platform_support"))
        self.assertEqual(
            self.client.post(download_url(theirs, job_id)).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertFalse(AuditLog.objects.filter(action="export_download").exists())

    def test_a_succeeded_export_is_audited_with_its_counts(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)
        populate(tenant, students=[StudentStatus.ACTIVE, StudentStatus.ACTIVE], files=[10])

        job_id = self.export(tenant).json()["data"]["job_id"]

        row = AuditLog.objects.get(action="export_succeeded")
        self.assertEqual(row.tenant_id, tenant.pk)
        self.assertIsNone(row.actor_id)
        self.assertEqual(str(row.resource_id), job_id)
        with tenant_context(tenant.pk):
            result = BackgroundJob.objects.get(pk=job_id).result
        self.assertEqual(
            row.after,
            {
                "tables": result["tables"],
                "rows": result["rows"],
                "files": 1,
                "missing_files": [],
            },
        )
        self.assertGreaterEqual(row.after["rows"], 2)

    def test_a_missing_stored_object_is_listed_not_fatal(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)
        populate(tenant, files=[10, 20])
        with tenant_context(tenant.pk):
            lost, kept = File.objects.order_by("pk")

        def open_object(_presigner, *, storage_key: str):
            if storage_key == lost.storage_key:
                raise FileNotFoundError(storage_key)
            return io.BytesIO(b"bytes")

        with mock.patch.object(NullPresigner, "open", autospec=True, side_effect=open_object):
            job_id = self.export(tenant).json()["data"]["job_id"]

        with tenant_context(tenant.pk):
            job = BackgroundJob.objects.get(pk=job_id)
        self.assertEqual(job.status, JobStatus.SUCCEEDED, job.error)
        self.assertEqual(job.result["missing_files"], [str(lost.pk)])
        self.assertEqual(job.result["files"], 1)
        names = self.archive().namelist()
        self.assertIn(f"files/{kept.pk}-{kept.original_name}", names)
        self.assertNotIn(f"files/{lost.pk}-{lost.original_name}", names)

    def test_a_stale_job_is_failed_and_replaced(self) -> None:
        limit = timedelta(seconds=settings.PLATFORM_EXPORT_TIME_LIMIT_SECONDS)
        long_ago = timezone.now() - limit - timedelta(minutes=1)
        for stuck_status in (JobStatus.RUNNING, JobStatus.QUEUED):
            with self.subTest(status=stuck_status):
                tenant = make_tenant(status=S.ACTIVE)
                with tenant_context(tenant.pk):
                    stuck = BackgroundJob.objects.create(
                        tenant=tenant,
                        job_type=TENANT_EXPORT_JOB_TYPE,
                        status=stuck_status,
                        started_at=long_ago if stuck_status == JobStatus.RUNNING else None,
                    )
                    BackgroundJob.objects.filter(pk=stuck.pk).update(created_at=long_ago)

                response = self.export(tenant)

                self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.content)
                self.assertNotEqual(response.json()["data"]["job_id"], str(stuck.pk))
                with tenant_context(tenant.pk):
                    stuck.refresh_from_db()
                self.assertEqual(stuck.status, JobStatus.FAILED)
                self.assertTrue(stuck.error)

    def test_the_export_task_is_time_limited(self) -> None:
        hard = settings.PLATFORM_EXPORT_TIME_LIMIT_SECONDS
        self.assertEqual(export_tenant.time_limit, hard)
        self.assertLess(export_tenant.soft_time_limit, hard)
        self.assertGreater(export_tenant.soft_time_limit, 0)

    def test_an_export_in_flight_is_returned_not_repeated(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)
        with tenant_context(tenant.pk):
            running = BackgroundJob.objects.create(
                tenant=tenant,
                job_type=TENANT_EXPORT_JOB_TYPE,
                status=JobStatus.RUNNING,
                created_by=self.operator.pk,
            )

        response = self.export(tenant)

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.content)
        self.assertEqual(response.json()["data"]["job_id"], str(running.pk))
        self.assertEqual(self.archives, [])

    def test_job_of_other_tenant_404(self) -> None:
        mine, theirs = make_tenant(status=S.ACTIVE), make_tenant(status=S.ACTIVE)
        job_id = self.export(theirs).json()["data"]["job_id"]
        with tenant_context(mine.pk):
            other_kind = BackgroundJob.objects.create(tenant=mine, job_type="export.students")

        # Named under another school, the job is not there.
        self.assertEqual(
            self.client.get(jobs_url(mine, job_id)).status_code, status.HTTP_404_NOT_FOUND
        )
        # The console polls platform jobs only, not a school's own.
        self.assertEqual(
            self.client.get(jobs_url(mine, other_kind.pk)).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(
            self.client.get(jobs_url(mine, "not-a-uuid")).status_code, status.HTTP_404_NOT_FOUND
        )
        # A school's own principal never reaches the console.
        principal = UserFactory(tenant=theirs)
        grant(principal, "platform.job.view")
        self.client.credentials(HTTP_AUTHORIZATION=bearer(principal))
        self.assertEqual(
            self.client.get(jobs_url(theirs, job_id)).status_code, status.HTTP_404_NOT_FOUND
        )
        self.assertEqual(
            self.client.post(tenant_url(theirs, ":export")).status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_only_the_export_key_may_export_or_poll(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)
        job_id = self.export(tenant).json()["data"]["job_id"]

        # `platform_support` reads tenants but holds no export key (§4).
        self.sign_in_as(platform_user("platform_support"))
        self.assertEqual(
            self.client.post(tenant_url(tenant, ":export")).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.get(jobs_url(tenant, job_id)).status_code, status.HTTP_403_FORBIDDEN
        )

    def test_export_replays_under_the_same_key(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)

        first = self.export(tenant, HTTP_IDEMPOTENCY_KEY="export-1")
        second = self.export(tenant, HTTP_IDEMPOTENCY_KEY="export-1")

        self.assertEqual(first.json()["data"]["job_id"], second.json()["data"]["job_id"])
        with tenant_context(tenant.pk):
            self.assertEqual(
                BackgroundJob.objects.filter(job_type=TENANT_EXPORT_JOB_TYPE).count(), 1
            )

    def test_succeeded_export_unblocks_delete(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)
        refused = self.client.post(tenant_url(tenant, ":delete"), {"reason": "closing"})
        self.assert_error(refused, status.HTTP_409_CONFLICT, "export_required")

        self.export(tenant)
        response = self.client.post(tenant_url(tenant, ":delete"), {"reason": "closing"})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertEqual(response.json()["data"]["status"], S.DEPROVISIONED)

    def test_a_failed_export_is_recorded_on_the_job(self) -> None:
        tenant = make_tenant(status=S.ACTIVE)
        with mock.patch(
            "apps.platform_admin.export.services.write_archive",
            side_effect=RuntimeError("storage down"),
        ):
            job_id = self.export(tenant).json()["data"]["job_id"]

        with tenant_context(tenant.pk):
            job = BackgroundJob.objects.get(pk=job_id)
        self.assertEqual(job.status, JobStatus.FAILED)
        self.assertIn("storage down", job.error)
