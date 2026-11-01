"""A record scope narrows only the keys its own role grants (auth-and-rbac.md §2.3).

`scope_queryset` used to read the union of every role's scope, whatever the route's
key. A user holding a campus-scoped role for the key a route needs, plus *any*
`all`-scoped role for something unrelated, read tenant-wide. Every mixed user below
therefore carries an unrelated `all` role: against the key-blind union each test
reads more than it should, and fails.

Lives here rather than in one module's tests because the bug was in `core.rbac` and
its callers span students, attendance, fees and examinations.
"""

from __future__ import annotations

import datetime
import uuid
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.attendance import services as attendance_services
from apps.attendance.tasks import export_attendance_report_task
from apps.attendance.tests.test_approvals_api import LOCKED_DATE, ApprovalsTestCase
from apps.attendance.views import AttendanceCorrectionViewSet
from apps.examinations.tasks import export_exam_report_task
from apps.examinations.tests.test_reports import ReportDataTestCase as ExamReportTestCase
from apps.fees_finance.tasks import export_finance_report_task
from apps.fees_finance.tests.test_reports import ReportTestCase as FinanceReportTestCase
from apps.school_organization.tests.factories import (
    CampusFactory,
    SectionFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.student_management.models import Student
from apps.student_management.tests.factories import (
    StudentEnrollmentFactory,
    StudentFactory,
    enable_feature,
)
from core.exports import tabular
from core.exports.scope import MISSING_SCOPE_PERMISSION
from core.jobs.models import BackgroundJob, JobStatus
from core.jobs.services import create_job
from core.rbac.models import RecordScope, UserRole
from core.rbac.permissions import AnyOf, scopes_for
from core.tenancy.context import tenant_context

# A key no route below declares: the "unrelated" `all` role each mixed user holds.
UNRELATED = "exams.exam.view"

STUDENT_VIEW = "students.student.view"
GUARDIAN_VIEW = "students.guardian.view"
ATTENDANCE_VIEW = "attendance.student-attendance.view"
CORRECTION_CREATE = "attendance.correction.create"
REPORT_VIEW = "attendance.report.view"
REPORT_EXPORT = "attendance.report.export"

CORRECTIONS = "/api/v1/attendance-corrections"
ATTENDANCE_REPORTS = "/api/v1/reports/attendance-summary"


def ids(response) -> set[str]:
    return {str(row["id"]) for row in response.json()["data"]}


def student_ids(rows) -> set[str]:
    return {str(row["student_id"]) for row in rows}


class StudentScopeTests(APITestCase):
    """The mixin, and a nested route's parent lookup, on `/students`."""

    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        enable_feature(self.tenant, "module.students")
        with tenant_context(self.tenant.id):
            self.campus_a = CampusFactory(tenant=self.tenant)
            self.campus_b = CampusFactory(tenant=self.tenant)
            self.student_a = StudentFactory(tenant=self.tenant, campus=self.campus_a)
            self.student_b = StudentFactory(tenant=self.tenant, campus=self.campus_b)
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)

    def on_campus_a(self, *keys: str) -> None:
        grant(self.user, *keys, scope=RecordScope.CAMPUS, scope_ref=self.campus_a.pk)

    def test_unrelated_all_role_does_not_widen_campus_scope(self) -> None:
        """Review Focus 1: the exploit through the viewset mixin."""
        self.on_campus_a(STUDENT_VIEW)
        grant(self.user, UNRELATED, scope=RecordScope.ALL)

        response = self.client.get("/api/v1/students")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(ids(response), {str(self.student_a.pk)})

    def test_nested_route_needs_the_parents_view_scope(self) -> None:
        """Review Focus 3: the guardian key is held tenant-wide, the student key on
        campus A only, so a campus-B student's guardians are a 404."""
        grant(self.user, GUARDIAN_VIEW, scope=RecordScope.ALL)
        self.on_campus_a(STUDENT_VIEW)

        foreign = self.client.get(f"/api/v1/students/{self.student_b.pk}/guardians")
        own = self.client.get(f"/api/v1/students/{self.student_a.pk}/guardians")

        self.assertEqual(foreign.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(own.status_code, status.HTTP_200_OK, own.json())

    def test_all_scoped_holder_of_the_key_still_reads_tenant_wide(self) -> None:
        """The control: a narrower role for something else does not narrow an `all`
        grant of the route's own key, on the list or through a nested parent."""
        grant(self.user, STUDENT_VIEW, GUARDIAN_VIEW, scope=RecordScope.ALL)
        self.on_campus_a(UNRELATED)

        listed = self.client.get("/api/v1/students")
        nested = self.client.get(f"/api/v1/students/{self.student_b.pk}/guardians")

        self.assertEqual(ids(listed), {str(self.student_a.pk), str(self.student_b.pk)})
        self.assertEqual(nested.status_code, status.HTTP_200_OK, nested.json())


class AttendanceScopeTests(ApprovalsTestCase):
    """Records, a correction's target, and a report export, across two campuses."""

    def setUp(self) -> None:
        super().setUp()
        self.row_a = self.locked_row()
        self.row_b = self.campus_b_locked_row()
        self.reader = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.reader)

    def on_campus_a(self, *keys: str) -> None:
        grant(self.reader, *keys, scope=RecordScope.CAMPUS, scope_ref=self.campus.pk)

    def report_params(self) -> dict[str, str]:
        return {
            "kind": "student-summary",
            "start_date": LOCKED_DATE.isoformat(),
            "end_date": LOCKED_DATE.isoformat(),
        }

    def run_export(self, job_id: str) -> tuple[BackgroundJob, list[dict]]:
        """Run the export task, returning the finished job and the rows it wrote."""
        written: list[dict] = []
        real_render = tabular.render

        def capture(rows, **kwargs):
            written.extend(rows)
            return real_render(rows, **kwargs)

        with mock.patch.object(tabular, "render", side_effect=capture):
            export_attendance_report_task(
                tenant_id=str(self.tenant.pk), job_id=job_id, actor_id=str(self.reader.pk)
            )
        with tenant_context(self.tenant.id):
            return BackgroundJob.objects.get(pk=job_id), written

    def test_unrelated_all_role_does_not_widen_attendance_records(self) -> None:
        self.on_campus_a(ATTENDANCE_VIEW)
        grant(self.reader, UNRELATED, scope=RecordScope.ALL)

        response = self.client.get("/api/v1/student-attendance")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(ids(response), {str(self.row_a.pk)})

    def test_correction_target_needs_the_attendance_view_scope(self) -> None:
        """attendance.md §16: the target is scoped as `GET /student-attendance` scopes
        it. The correction key is held tenant-wide, the view key on campus A only."""
        grant(self.reader, CORRECTION_CREATE, scope=RecordScope.ALL)
        self.on_campus_a(ATTENDANCE_VIEW)

        foreign = self.client.post(CORRECTIONS, self.body(self.row_b), format="json")
        own = self.client.post(CORRECTIONS, self.body(self.row_a), format="json")

        self.assertEqual(foreign.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(own.status_code, status.HTTP_201_CREATED, own.json())

    def test_get_overflow_export_uses_the_view_scope(self) -> None:
        """Review Focus 5: a GET over the inline ceiling queues the job under the GET's
        own view key (campus A), so a tenant-wide export role cannot widen the file
        beyond what the inline report would have shown."""
        self.on_campus_a(REPORT_VIEW)
        grant(self.reader, REPORT_EXPORT, scope=RecordScope.ALL)
        query = "&".join(f"{key}={value}" for key, value in self.report_params().items())

        with mock.patch.object(attendance_services, "SYNCHRONOUS_REPORT_ROW_LIMIT", 0):
            response = self.client.get(f"{ATTENDANCE_REPORTS}?{query}")

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        job_id = response.json()["data"]["job_id"]
        with tenant_context(self.tenant.id):
            payload = BackgroundJob.objects.get(pk=job_id).payload
        self.assertEqual(payload["scope_permission"], [REPORT_VIEW])

        job, written = self.run_export(job_id)

        self.assertEqual(job.status, JobStatus.SUCCEEDED, job.error)
        self.assertEqual(student_ids(written), {str(self.row_a.student_id)})

    def test_export_job_after_role_removed_reads_nothing(self) -> None:
        """The job re-reads the requester's roles for the key it was queued under, so
        removing the export role before it runs leaves nothing to export, even though
        an unrelated `all` role is still held."""
        export_role = grant(self.reader, REPORT_EXPORT, scope=RecordScope.ALL)
        grant(self.reader, UNRELATED, scope=RecordScope.ALL)
        response = self.client.post(ATTENDANCE_REPORTS, self.report_params(), format="json")
        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())

        with tenant_context(self.tenant.id):
            assignment = UserRole.objects.get(user=self.reader, role=export_role)
            assignment.deleted_at = timezone.now()
            assignment.save(update_fields=["deleted_at", "updated_at"])
        job, written = self.run_export(response.json()["data"]["job_id"])

        self.assertEqual(job.status, JobStatus.SUCCEEDED, job.error)
        self.assertEqual(job.result["rows"], 0)
        self.assertEqual(written, [])


class FinanceReportScopeTests(FinanceReportTestCase):
    def test_unrelated_all_role_does_not_widen_finance_report(self) -> None:
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
                enrollment_date=datetime.date(2026, 4, 1),
            )
        self._invoice(due=datetime.date(2026, 9, 10), label="a")
        self._invoice(student=student_b, due=datetime.date(2026, 9, 10), label="b")
        reader = UserFactory(tenant=self.tenant)
        grant(reader, "fees.report.view", scope=RecordScope.CAMPUS, scope_ref=self.campus.pk)
        grant(reader, UNRELATED, scope=RecordScope.ALL)
        authenticate(self.client, reader)

        response = self.client.get(
            "/api/v1/reports/finance-summary"
            "?kind=outstanding-aging&date_from=2026-01-01&date_to=2027-01-01"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(student_ids(response.json()["data"]), {str(self.student.pk)})


class ExamReportScopeTests(ExamReportTestCase):
    def test_unrelated_all_role_does_not_widen_exam_report(self) -> None:
        with tenant_context(self.tenant.id):
            campus_b = CampusFactory(tenant=self.tenant)
            moved = self.students[2]
            Student.objects.filter(pk=moved.pk).update(campus=campus_b)
        reader = UserFactory(tenant=self.tenant)
        grant(reader, "exams.result.view", scope=RecordScope.CAMPUS, scope_ref=self.campus.pk)
        grant(reader, STUDENT_VIEW, scope=RecordScope.ALL)
        authenticate(self.client, reader)

        response = self.client.get(
            f"/api/v1/reports/exam-summary?kind=result-register&exam_id={self.exam.pk}"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(
            student_ids(response.json()["data"]),
            {str(self.students[0].pk), str(self.students[1].pk)},
        )


class LegacyExportJobTests(TestCase):
    def test_legacy_export_job_without_key_fails_closed(self) -> None:
        """Review Focus 5: a job queued before `scope_permission` existed is refused
        with a message the requester can act on, rather than read under every role.
        Each payload is otherwise complete, so only the missing key can refuse it."""
        tenant = TenantFactory()
        requester = UserFactory(tenant=tenant)
        grant(requester, UNRELATED, scope=RecordScope.ALL)
        cases = (
            (
                export_attendance_report_task,
                "attendance.report-export",
                {"kind": "student-summary", "start_date": "2026-09-01", "end_date": "2026-09-01"},
            ),
            (
                export_finance_report_task,
                "fees.export-report",
                {"kind": "collection", "date_from": "2026-01-01", "date_to": "2027-01-01"},
            ),
            (
                export_exam_report_task,
                "exams.report-export",
                {"kind": "question-bank-usage", "exam_id": None},
            ),
        )

        for task, job_type, payload in cases:
            with self.subTest(job_type=job_type):
                with tenant_context(tenant.id):
                    job = create_job(
                        tenant_id=tenant.pk,
                        job_type=job_type,
                        payload={**payload, "requested_by": str(requester.pk)},
                        actor_id=requester.pk,
                    )

                task(tenant_id=str(tenant.pk), job_id=str(job.pk), actor_id=str(requester.pk))

                with tenant_context(tenant.id):
                    job = BackgroundJob.objects.get(pk=job.pk)
                self.assertEqual(job.status, JobStatus.FAILED)
                self.assertEqual(job.error, MISSING_SCOPE_PERMISSION)


class RouteScopeMapTests(TestCase):
    def test_any_of_scopes_map_is_the_union(self) -> None:
        """The correction queue's `AnyOf` reads the union over the roles granting either
        of its keys, and never an unrelated role's `all`. `scopes_for` only: the list
        built from a mixed-type union is PR B's."""
        tenant = TenantFactory()
        user = UserFactory(tenant=tenant)
        campus_a, campus_b = uuid.uuid4(), uuid.uuid4()
        grant(user, CORRECTION_CREATE, scope=RecordScope.CAMPUS, scope_ref=campus_a)
        grant(user, "attendance.correction.approve", scope=RecordScope.CAMPUS, scope_ref=campus_b)
        grant(user, UNRELATED, scope=RecordScope.ALL)
        declared = AttendanceCorrectionViewSet.required_permission_map["list"]
        self.assertIsInstance(declared, AnyOf)

        scopes = scopes_for(user, declared)

        self.assertEqual(list(scopes), [RecordScope.CAMPUS])
        self.assertCountEqual(scopes[RecordScope.CAMPUS], [campus_a, campus_b])
