"""Quota enforcement at create time (platform-admin.md §5, §11, §12; Review Focus 5).

`core.tenancy.quotas.check_quota` is the one check: this app registers the limits (the live
plan and its override) and the counters (`usage.services.USAGE_COUNTERS`) from `ready()`, and
the student, staff and file services call core, never this app (ADR-0013).
"""

from __future__ import annotations

import datetime
import io
import time
from concurrent.futures import Future, ThreadPoolExecutor
from decimal import Decimal
from unittest import mock

from django.db import IntegrityError, connection, connections
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.platform_admin import notifications
from apps.platform_admin.subscriptions import services as subscriptions
from apps.platform_admin.tests.base import make_plan
from apps.platform_admin.tests.test_lifecycle import owner_of
from apps.platform_admin.usage import services as usage
from apps.school_organization.tests.factories import (
    CampusFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.staff_management.staff.services.create import create_staff
from apps.staff_management.staff.services.import_staff import import_staff_row
from apps.staff_management.tests.factories import StaffFactory
from apps.student_management.models import Student
from apps.student_management.services import create_student, import_student_row
from apps.student_management.tasks import import_students_task
from apps.student_management.tests.factories import StudentFactory, enable_feature
from core.files.services import create_upload
from core.files.tests.factories import FileFactory
from core.imports.tabular import ROW_NUMBER_KEY
from core.jobs.models import BackgroundJob
from core.jobs.tests.base import run_on_commit
from core.notifications.models import Notification
from core.tenancy import quotas
from core.tenancy.context import TenantContextRequired, tenant_atomic, tenant_context
from core.tenancy.locks import AdvisoryLockNamespace

GIB = 1024**3
MODULES = ["module.students", "module.staff"]
DOB = "2015-03-04"
ADMITTED = "2026-04-01"
STUDENT_HEADER = "first_name,last_name,date_of_birth,gender,campus_code,admission_date\n"
STAFF_HEADER = "first_name,last_name,staff_type,campus_code,joining_date,phone\n"
LOCK_WAIT_SECONDS = 10
LOCK_POLL_SECONDS = 0.05


def on_plan(tenant, **limits):
    """``tenant`` on a trial of a plan with ``limits`` (absent metrics are unlimited)."""
    return subscriptions.start_trial(
        tenant, make_plan(limits=limits, enabled_modules=MODULES), actor_id=None
    )


def student_rows(count: int) -> str:
    return STUDENT_HEADER + "".join(
        f"Pupil{n},Khan,{DOB},female,MAIN,{ADMITTED}\n" for n in range(count)
    )


def staff_rows(count: int) -> str:
    return STAFF_HEADER + "".join(
        f"Teacher{n},Khan,teaching,MAIN,{ADMITTED},+92300000{n:04d}\n" for n in range(count)
    )


class QuotaTestCase(APITestCase):
    """A signed-in school user at a school with a campus coded `MAIN`."""

    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)
        for key in MODULES:
            enable_feature(self.tenant, key)
        with tenant_context(self.tenant.pk):
            self.campus = CampusFactory(tenant=self.tenant, code="MAIN")

    def students(self, count: int) -> None:
        with tenant_context(self.tenant.pk):
            for _ in range(count):
                StudentFactory(tenant=self.tenant, campus=self.campus)

    def student_count(self) -> int:
        with tenant_context(self.tenant.pk):
            return usage.count_students(self.tenant.pk)

    def post_student(self, first_name: str = "Amina"):
        grant(self.user, "students.student.create", "students.student.view")
        return run_on_commit(
            self,
            lambda: self.client.post(
                "/api/v1/students",
                {
                    "first_name": first_name,
                    "last_name": "Khan",
                    "date_of_birth": DOB,
                    "gender": "female",
                    "campus_id": str(self.campus.pk),
                    "admission_date": ADMITTED,
                },
                format="json",
            ),
        )

    def upload(self, path: str, key: str, content: str):
        grant(self.user, key)
        upload = io.BytesIO(content.encode())
        upload.name = "rows.csv"
        return run_on_commit(
            self, lambda: self.client.post(path, {"file": upload}, format="multipart")
        )

    def assert_quota_exceeded(
        self, response, *, metric: str, limit: int, usage, adding: int = 1
    ) -> None:
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT, response.content)
        error = response.json()["error"]
        self.assertEqual(error["code"], "quota_exceeded")
        self.assertEqual(
            error["meta"], {"metric": metric, "limit": limit, "usage": usage, "adding": adding}
        )

    def threshold_notices(self) -> int:
        with tenant_context(self.tenant.pk):
            return Notification.objects.filter(event_key=notifications.QUOTA_THRESHOLD).count()


class QuotaRefusalTests(QuotaTestCase):
    def test_create_at_limit_is_409(self) -> None:
        on_plan(self.tenant, students=2)
        self.students(2)

        response = self.post_student()

        self.assert_quota_exceeded(response, metric="students", limit=2, usage=2)
        self.assertEqual(self.student_count(), 2)

    def test_create_below_limit_succeeds(self) -> None:
        on_plan(self.tenant, students=2)
        self.students(1)

        response = self.post_student()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        self.assertEqual(self.student_count(), 2)

    def test_staff_create_at_limit_is_refused(self) -> None:
        on_plan(self.tenant, staff=1)
        with tenant_atomic(self.tenant.pk):
            StaffFactory(tenant=self.tenant, campus=self.campus)
            with self.assertRaises(quotas.QuotaExceeded) as refused:
                create_staff(
                    campus=self.campus,
                    joining_date=datetime.date(2026, 4, 1),
                    first_name="Bilal",
                    last_name="Rahman",
                    staff_type="teaching",
                    phone="+923001234567",
                    actor_id=self.user.pk,
                    tenant_id=self.tenant.pk,
                )
        self.assertEqual(
            refused.exception.meta, {"metric": "staff", "limit": 1, "usage": 1, "adding": 1}
        )

    def test_upload_past_the_storage_limit_is_refused(self) -> None:
        on_plan(self.tenant, storage_gb=1)
        with tenant_atomic(self.tenant.pk):
            FileFactory(tenant=self.tenant, size_bytes=GIB - 2048)

            def upload(size_bytes: int):
                return create_upload(
                    tenant_id=self.tenant.pk,
                    purpose="student.document",
                    original_name="a.pdf",
                    mime_type="application/pdf",
                    size_bytes=size_bytes,
                    actor_id=self.user.pk,
                )

            # Filling the quota exactly to 1 GiB is allowed; one byte more is not.
            upload(2048)
            with self.assertRaises(quotas.QuotaExceeded) as refused:
                upload(1)
        self.assertEqual(refused.exception.meta["metric"], "storage_gb")
        self.assertEqual(refused.exception.meta["limit"], 1)

    def test_import_over_remaining_refused_at_upload(self) -> None:
        on_plan(self.tenant, students=5)
        self.students(3)

        response = self.upload(
            "/api/v1/student-imports", "students.student.import", student_rows(3)
        )

        self.assert_quota_exceeded(response, metric="students", limit=5, usage=3, adding=3)
        with tenant_context(self.tenant.pk):
            self.assertFalse(BackgroundJob.objects.exists())
        self.assertEqual(self.student_count(), 3)

    def test_import_within_remaining_is_queued(self) -> None:
        on_plan(self.tenant, students=5)
        self.students(3)

        response = self.upload(
            "/api/v1/student-imports", "students.student.import", student_rows(2)
        )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.content)
        self.assertEqual(self.student_count(), 5)

    def test_an_accepted_upload_sends_no_notice_and_no_warning(self) -> None:
        # The upload only refuses: its rows may never exist, so only the job's creates count.
        owner_of(self.tenant)
        on_plan(self.tenant, students=10)
        self.students(6)

        with mock.patch.object(import_students_task, "apply_async"):
            response = self.upload(
                "/api/v1/student-imports", "students.student.import", student_rows(4)
            )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.content)
        self.assertNotIn("warnings", response.json().get("meta", {}))
        self.assertEqual(self.threshold_notices(), 0)

    def test_staff_import_over_remaining_refused_at_upload(self) -> None:
        on_plan(self.tenant, staff=1)

        response = self.upload("/api/v1/staff-imports", "staff.staff.import", staff_rows(2))

        self.assert_quota_exceeded(response, metric="staff", limit=1, usage=0, adding=2)
        with tenant_context(self.tenant.pk):
            self.assertFalse(BackgroundJob.objects.exists())

    def test_an_import_row_past_the_limit_is_a_row_error(self) -> None:
        # Another create can land between the upload's check and the job's rows.
        on_plan(self.tenant, students=1, staff=1)
        self.students(1)
        with tenant_context(self.tenant.pk):
            StaffFactory(tenant=self.tenant, campus=self.campus)
        student_row = {
            ROW_NUMBER_KEY: "2",
            "first_name": "Amina",
            "last_name": "Khan",
            "date_of_birth": DOB,
            "gender": "female",
            "campus_code": "MAIN",
            "admission_date": ADMITTED,
        }
        staff_row = {
            ROW_NUMBER_KEY: "2",
            "first_name": "Bilal",
            "last_name": "Rahman",
            "staff_type": "teaching",
            "campus_code": "MAIN",
            "joining_date": ADMITTED,
            "phone": "+923001234567",
        }

        student_error = import_student_row(
            row=student_row,
            tenant_id=self.tenant.pk,
            actor_id=self.user.pk,
            campuses_by_code={"MAIN": self.campus},
        )
        staff_error = import_staff_row(
            row=staff_row,
            tenant_id=self.tenant.pk,
            actor_id=self.user.pk,
            campuses_by_code={"MAIN": self.campus},
        )

        self.assertEqual(student_error["field"], "non_field")
        self.assertIn("limit", student_error["issue"])
        self.assertEqual(staff_error["field"], "non_field")


class QuotaWarningTests(QuotaTestCase):
    def test_warn_band_adds_meta_warning(self) -> None:
        on_plan(self.tenant, students=10)
        self.students(8)

        response = self.post_student()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        [warning] = response.json()["meta"]["warnings"]
        self.assertEqual(warning["code"], "quota_warning")
        self.assertEqual(warning["details"], {"metric": "students", "limit": 10, "usage": 9})
        self.assertTrue(warning["message"])

    def test_the_warn_band_starts_at_eighty_percent(self) -> None:
        on_plan(self.tenant, students=10)
        self.students(7)

        response = self.post_student()

        [warning] = response.json()["meta"]["warnings"]
        self.assertEqual(warning["details"]["usage"], 8)

    def test_below_the_warn_band_adds_no_warning(self) -> None:
        on_plan(self.tenant, students=10)
        self.students(6)

        response = self.post_student()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        self.assertNotIn("warnings", response.json().get("meta", {}))

    def test_null_limit_is_unlimited(self) -> None:
        on_plan(self.tenant, staff=1)  # `students` absent: unlimited.
        self.students(25)

        response = self.post_student()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        self.assertNotIn("warnings", response.json().get("meta", {}))
        with tenant_atomic(self.tenant.pk):
            self.assertIsNone(quotas.check_quota(self.tenant.pk, "students", adding=1000))

    def test_a_school_without_a_subscription_has_no_limits(self) -> None:
        self.students(3)
        with tenant_atomic(self.tenant.pk):
            self.assertIsNone(quotas.check_quota(self.tenant.pk, "students"))

    def test_check_needs_the_school_bound(self) -> None:
        on_plan(self.tenant, students=10)
        with self.assertRaises(TenantContextRequired):
            quotas.check_quota(self.tenant.pk, "students")

    def test_threshold_notice_sent_once(self) -> None:
        owner = owner_of(self.tenant)
        on_plan(self.tenant, students=10)
        self.students(7)

        self.assertEqual(self.post_student("First").status_code, status.HTTP_201_CREATED)
        # Back below the band and across it again: the same band, the same period.
        with tenant_context(self.tenant.pk):
            Student.objects.filter(first_name="First").update(deleted_at=timezone.now())
        self.assertEqual(self.post_student("Second").status_code, status.HTTP_201_CREATED)

        with tenant_context(self.tenant.pk):
            sent = list(Notification.objects.filter(event_key=notifications.QUOTA_THRESHOLD))
        self.assertEqual([n.user_id for n in sent], [owner.pk])

        # Within the band is no new crossing; reaching the limit is the next band.
        self.assertEqual(self.post_student("Third").status_code, status.HTTP_201_CREATED)
        self.assertEqual(self.threshold_notices(), 1)
        self.assertEqual(self.post_student("Fourth").status_code, status.HTTP_201_CREATED)
        self.assertEqual(self.threshold_notices(), 2)

    def test_a_rolled_back_create_sends_no_notice(self) -> None:
        # The check passes and crosses into the band; the insert after it fails and rolls back.
        owner_of(self.tenant)
        on_plan(self.tenant, students=10)
        self.students(7)

        with mock.patch.object(
            Student.objects, "create", side_effect=IntegrityError("forced after the check")
        ):
            response = self.post_student()

        self.assertNotEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(self.threshold_notices(), 0)


class QuotaSeamTests(TestCase):
    def test_the_platform_console_registers_the_limits_and_the_counters(self) -> None:
        self.assertIs(quotas._hooks["resolver"], subscriptions.effective_limits)
        self.assertEqual(quotas._counters["students"], (usage.count_students, 1))
        self.assertEqual(quotas._counters["staff"], (usage.count_staff, 1))
        # Storage counts and compares in bytes; GiB is only the limit's unit.
        self.assertEqual(
            quotas._counters["storage_gb"], (usage.count_storage_bytes, quotas.BYTES_PER_GB)
        )
        self.assertIn("listener", quotas._hooks)

    def test_the_quota_lock_has_its_own_namespace(self) -> None:
        self.assertEqual(int(AdvisoryLockNamespace.QUOTA), 2)

    def test_storage_adds_in_gib(self) -> None:
        self.assertEqual(quotas.bytes_to_gb(GIB // 2), Decimal("0.5"))


class ConcurrentQuotaTests(TransactionTestCase):
    """Two creates at limit − 1: the advisory lock makes the second count after the first."""

    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        with tenant_atomic(self.tenant.pk):
            self.actor = UserFactory(tenant=self.tenant)
            self.campus = CampusFactory(tenant=self.tenant)
            StudentFactory(tenant=self.tenant, campus=self.campus)
        on_plan(self.tenant, students=2)

    def create(self, first_name: str) -> Student:
        return create_student(
            campus=self.campus,
            admission_date=datetime.date(2026, 4, 1),
            date_of_birth=datetime.date(2015, 3, 4),
            first_name=first_name,
            last_name="Khan",
            gender="female",
            actor_id=self.actor.pk,
            tenant_id=self.tenant.pk,
        )

    def wait_until_blocked(self, contending: Future) -> None:
        deadline = time.monotonic() + LOCK_WAIT_SECONDS
        while time.monotonic() < deadline:
            with connection.cursor() as cursor:
                # Only the quota lock: two-int advisory locks keep the namespace in `classid`.
                cursor.execute(
                    "SELECT count(*) FROM pg_locks WHERE NOT granted "
                    "AND locktype = 'advisory' AND classid = %s",
                    [int(AdvisoryLockNamespace.QUOTA)],
                )
                (waiting,) = cursor.fetchone()
            if waiting:
                return
            self.assertFalse(contending.done(), "the contending create returned without waiting")
            time.sleep(LOCK_POLL_SECONDS)
        self.fail("the contending create never waited on the quota lock")

    def test_concurrent_creates_at_limit_minus_one(self) -> None:
        def contender() -> Student:
            try:
                with tenant_atomic(self.tenant.pk):
                    return self.create("Second")
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with tenant_atomic(self.tenant.pk):
                self.create("First")
                contending = pool.submit(contender)
                self.wait_until_blocked(contending)
            with self.assertRaises(quotas.QuotaExceeded):
                contending.result(timeout=LOCK_WAIT_SECONDS)

        with tenant_atomic(self.tenant.pk):
            self.assertEqual(usage.count_students(self.tenant.pk), 2)
