"""A record scope narrows only the keys its own role grants (auth-and-rbac.md §2.3).

`scope_queryset` used to read the union of every role's scope, whatever the route's
key. A user holding a campus-scoped role for the key a route needs, plus *any*
`all`-scoped role for something unrelated, read tenant-wide. Every mixed user below
therefore carries an unrelated `all` role: against the key-blind union each test
reads more than it should, and fails.

The mixed-type tests hold one key at several scope types. Against first-wins
precedence (campus > own > assigned) each reads less than the union, and fails.
`test_single_scope_type_sql_is_unchanged` is the guard the other way: one type
keeps its exact filter.

Lives here rather than in one module's tests because the bug was in `core.rbac` and
its callers span students, attendance, fees and examinations.
"""

from __future__ import annotations

import datetime
import uuid
from decimal import Decimal
from unittest import mock

from django.db import connection
from django.db.models import Q
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.attendance import services as attendance_services
from apps.attendance.models import StudentAttendance
from apps.attendance.tasks import export_attendance_report_task
from apps.attendance.tests.test_approvals_api import LOCKED_DATE, ApprovalsTestCase
from apps.attendance.tests.test_staff_register_api import StaffRegisterTestCase
from apps.attendance.views import AttendanceCorrectionViewSet, StudentAttendanceViewSet
from apps.communication.models import ThreadType
from apps.communication.threads.tests.base import ThreadAPITestCase
from apps.examinations import services as exam_services
from apps.examinations.tasks import export_exam_report_task
from apps.examinations.tests.test_reports import ReportDataTestCase as ExamReportTestCase
from apps.fees_finance.tasks import export_finance_report_task
from apps.fees_finance.tests.test_reports import ReportTestCase as FinanceReportTestCase
from apps.school_organization.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    SectionFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.staff_management.tests.base import StaffManagementAPITestCase
from apps.staff_management.tests.factories import StaffFactory
from apps.student_management.models import Student
from apps.student_management.tests.factories import (
    GuardianFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    StudentGuardianFactory,
    enable_feature,
)
from apps.timetable.substitutions.tests.test_cover import CoverTestCase
from apps.timetable.tests.base import TimetableAPITestCase
from apps.timetable.tests.factories import MONDAY
from core.exports import tabular
from core.exports.scope import MISSING_SCOPE_PERMISSION
from core.jobs.models import BackgroundJob, JobStatus
from core.jobs.services import create_job
from core.rbac.models import RecordScope, UserRole
from core.rbac.permissions import AnyOf, scope_queryset, scopes_for
from core.tenancy.context import tenant_context

# A key no route below declares: the "unrelated" `all` role each mixed user holds.
UNRELATED = "exams.exam.view"

STUDENT_VIEW = "students.student.view"
STUDENT_UPDATE = "students.student.update"
STUDENT_WITHDRAW = "students.student.withdraw"
GUARDIAN_VIEW = "students.guardian.view"
ATTENDANCE_VIEW = "attendance.student-attendance.view"
CORRECTION_CREATE = "attendance.correction.create"
CORRECTION_APPROVE = "attendance.correction.approve"
REPORT_VIEW = "attendance.report.view"
REPORT_EXPORT = "attendance.report.export"
STAFF_MARK = "attendance.staff-attendance.mark"

CORRECTIONS = "/api/v1/attendance-corrections"
ATTENDANCE_REPORTS = "/api/v1/reports/attendance-summary"


def ids(response) -> set[str]:
    return {str(row["id"]) for row in response.json()["data"]}


def student_ids(rows) -> set[str]:
    return {str(row["student_id"]) for row in rows}


def capture_rendered_rows(run) -> list[dict]:
    """Call `run()` (an export task) and return the rows it handed the renderer."""
    written: list[dict] = []
    real_render = tabular.render

    def capture(rows, **kwargs):
        written.extend(rows)
        return real_render(rows, **kwargs)

    with mock.patch.object(tabular, "render", side_effect=capture):
        run()
    return written


def job_payload(tenant, response) -> dict:
    with tenant_context(tenant.id):
        return BackgroundJob.objects.get(pk=response.json()["data"]["job_id"]).payload


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


class DetailWriteScopeTests(APITestCase):
    """A write's target must be readable as well as reachable by the action (ADR-0031
    decision 3). The mixin used to resolve PATCH, DELETE and colon actions by the
    action's key alone, so a tenant-wide action role reached, and echoed back, a
    student the caller's view role hides."""

    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        enable_feature(self.tenant, "module.students")
        with tenant_context(self.tenant.id):
            self.campus_a = CampusFactory(tenant=self.tenant)
            campus_b = CampusFactory(tenant=self.tenant)
            self.student_b = StudentFactory(
                tenant=self.tenant, campus=campus_b, medical_notes="Penicillin allergy"
            )
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)

    def view_on_campus_a(self) -> None:
        grant(self.user, STUDENT_VIEW, scope=RecordScope.CAMPUS, scope_ref=self.campus_a.pk)

    def stored_student_b(self) -> Student:
        with tenant_context(self.tenant.id):
            return Student.objects.get(pk=self.student_b.pk)

    def test_patch_outside_the_view_scope_is_a_404_and_leaks_nothing(self) -> None:
        grant(self.user, STUDENT_UPDATE, scope=RecordScope.ALL)
        self.view_on_campus_a()

        response = self.client.patch(
            f"/api/v1/students/{self.student_b.pk}", {"first_name": "Renamed"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertNotIn("Penicillin", response.content.decode())
        self.assertEqual(self.stored_student_b().first_name, self.student_b.first_name)

    def test_colon_action_outside_the_view_scope_is_a_404(self) -> None:
        grant(self.user, STUDENT_WITHDRAW, scope=RecordScope.ALL)
        self.view_on_campus_a()

        response = self.client.post(
            f"/api/v1/students/{self.student_b.pk}:withdraw",
            {"reason": "Family relocation", "effective_date": "2026-06-01"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.stored_student_b().status, self.student_b.status)

    def test_both_keys_at_all_still_write(self) -> None:
        """The control: chaining the view scope changes nothing for a tenant-wide reader."""
        grant(self.user, STUDENT_VIEW, STUDENT_UPDATE, scope=RecordScope.ALL)

        response = self.client.patch(
            f"/api/v1/students/{self.student_b.pk}", {"first_name": "Renamed"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["medical_notes"], "Penicillin allergy")
        self.assertEqual(self.stored_student_b().first_name, "Renamed")


class MixedScopeDetailWriteTests(APITestCase):
    """A detail write whose two chained scopes are each a union (Task 5's review).

    The user holds the view and update keys on campus A and at `assigned`. The mixin
    scopes a PATCH by the view key and then by the update key, and each call has two
    members, so the second call's correlated `EXISTS` subqueries are built over the
    first call's: nested `EXISTS`. First-wins precedence ran the campus branch alone,
    so the campus-B student this user class-teaches was a 404.
    """

    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        enable_feature(self.tenant, "module.students")
        self.user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            campus_a = CampusFactory(tenant=self.tenant)
            campus_b = CampusFactory(tenant=self.tenant)
            session = AcademicSessionFactory(tenant=self.tenant)
            school_class = ClassFactory(tenant=self.tenant)
            teacher = StaffFactory(tenant=self.tenant, campus=campus_b, user_id=self.user.pk)
            taught = SectionFactory(
                tenant=self.tenant,
                school_class=school_class,
                campus=campus_b,
                class_teacher_staff_id=teacher.pk,
            )
            untaught = SectionFactory(
                tenant=self.tenant, school_class=school_class, campus=campus_b
            )
            self.on_campus_a = StudentFactory(tenant=self.tenant, campus=campus_a)
            self.taught_on_b = StudentFactory(tenant=self.tenant, campus=campus_b)
            self.untaught_on_b = StudentFactory(tenant=self.tenant, campus=campus_b)
            for student, section in ((self.taught_on_b, taught), (self.untaught_on_b, untaught)):
                StudentEnrollmentFactory(
                    tenant=self.tenant,
                    student=student,
                    academic_session=session,
                    school_class=school_class,
                    section=section,
                )
        for scope, ref in ((RecordScope.CAMPUS, campus_a.pk), (RecordScope.ASSIGNED, None)):
            grant(self.user, STUDENT_VIEW, STUDENT_UPDATE, scope=scope, scope_ref=ref)
        authenticate(self.client, self.user)

    def patch(self, student: Student):
        return self.client.patch(
            f"/api/v1/students/{student.pk}", {"first_name": "Renamed"}, format="json"
        )

    def first_name(self, student: Student) -> str:
        with tenant_context(self.tenant.id):
            return Student.objects.get(pk=student.pk).first_name

    def test_a_patch_through_two_chained_unions_reaches_each_members_rows(self) -> None:
        with CaptureQueriesContext(connection) as captured:
            taught = self.patch(self.taught_on_b)
        # Read now: `captured_queries` slices the live query log, which the next request's
        # `request_started` signal clears.
        sql = [query["sql"] for query in captured.captured_queries]
        on_campus_a = self.patch(self.on_campus_a)
        untaught = self.patch(self.untaught_on_b)

        self.assertEqual(taught.status_code, status.HTTP_200_OK, taught.json())
        self.assertEqual(on_campus_a.status_code, status.HTTP_200_OK, on_campus_a.json())
        self.assertEqual(untaught.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.first_name(self.taught_on_b), "Renamed")
        self.assertEqual(self.first_name(self.untaught_on_b), self.untaught_on_b.first_name)
        # Two members per call, so one query carries both unions: the read key's two
        # `EXISTS`, and the action key's two built over them.
        self.assertTrue(sql, "the PATCH's queries were not captured")
        self.assertGreaterEqual(max(statement.count("EXISTS") for statement in sql), 4)


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
        written = capture_rendered_rows(
            lambda: export_attendance_report_task(
                tenant_id=str(self.tenant.pk), job_id=job_id, actor_id=str(self.reader.pk)
            )
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

    # One key held at several scope types reads their union (ADR-0031 decision 7).
    # `scope_queryset` used to return at the first of campus > own > assigned.

    def test_any_of_route_unions_scopes_of_matching_roles(self) -> None:
        """The queue's `AnyOf` holds the approve key on campus A and the create key at
        `assigned`. The reader's own campus-B request is reached only through
        `assigned`, so first-wins hid it behind the campus branch."""
        grant(self.reader, CORRECTION_APPROVE, scope=RecordScope.CAMPUS, scope_ref=self.campus.pk)
        grant(self.reader, CORRECTION_CREATE, scope=RecordScope.ASSIGNED)
        grant(self.reader, UNRELATED, scope=RecordScope.ALL)
        someone_else = UserFactory(tenant=self.tenant)
        theirs_on_a = self.correction(self.row_a, someone_else)
        mine_on_b = self.correction(self.row_b, self.reader)
        theirs_elsewhere = self.correction(self.campus_b_locked_row(), someone_else)

        response = self.client.get(CORRECTIONS)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(ids(response), {str(theirs_on_a.pk), str(mine_on_b.pk)})
        self.assertNotIn(str(theirs_elsewhere.pk), ids(response))

    def test_an_empty_member_does_not_fall_through_and_the_union_runs_in_report_cte(
        self,
    ) -> None:
        """A campus role with no campus reaches nothing, and adds nothing: it neither
        falls through to another type nor stops the `own` and `assigned` members from
        being combined inside the report's CTE (L22: that CTE compiles the scoped
        queryset to raw SQL). First-wins fell through the empty campus to `own`
        alone: the child, not the class."""
        child = self.row_b.student
        with tenant_context(self.tenant.id):
            guardian = GuardianFactory(tenant=self.tenant, user_id=self.teacher_user.pk)
            StudentGuardianFactory(
                tenant=self.tenant, student=child, guardian=guardian, has_portal_access=True
            )
        for scope in (RecordScope.CAMPUS, RecordScope.OWN, RecordScope.ASSIGNED):
            grant(self.teacher_user, REPORT_VIEW, scope=scope)
        authenticate(self.client, self.teacher_user)
        query = "&".join(f"{key}={value}" for key, value in self.report_params().items())

        response = self.client.get(f"{ATTENDANCE_REPORTS}?{query}")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(
            student_ids(response.json()["data"]),
            {str(self.row_a.student_id), str(child.pk)},
        )

    def test_single_scope_type_sql_is_unchanged(self) -> None:
        """A user whose key reaches rows through one type gets the exact filter that type
        always produced, not the `EXISTS` union. Each expected queryset is that type's
        branch body as it stood before the union. A campus role with no campus beside an
        `own` role leaves one type, so it too is the `own` hook's SQL."""
        kwargs = StudentAttendanceViewSet.scope_kwargs()

        def campus_filter(base, _user):
            return base.filter(Q(**{f"{kwargs['campus_field']}__in": [self.campus.pk]}))

        cases = (
            ("campus", ((RecordScope.CAMPUS, self.campus.pk),), campus_filter),
            ("own", ((RecordScope.OWN, None),), StudentAttendance.filter_owned_by_user),
            (
                "assigned",
                ((RecordScope.ASSIGNED, None),),
                StudentAttendance.filter_assigned_to_user,
            ),
            (
                "campus without a campus, and own",
                ((RecordScope.CAMPUS, None), (RecordScope.OWN, None)),
                StudentAttendance.filter_owned_by_user,
            ),
        )

        for label, grants, expected in cases:
            with self.subTest(label):
                user = UserFactory(tenant=self.tenant)
                for scope, ref in grants:
                    grant(user, ATTENDANCE_VIEW, scope=scope, scope_ref=ref)
                with tenant_context(self.tenant.id):
                    base = StudentAttendance.objects.alive()
                    scoped = scope_queryset(base, user, permission=ATTENDANCE_VIEW, **kwargs)
                    with CaptureQueriesContext(connection) as actual:
                        list(scoped)
                    with CaptureQueriesContext(connection) as before:
                        list(expected(base, user))

                self.assertEqual(len(actual), 1)
                self.assertEqual(actual[0]["sql"], before[0]["sql"])


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

    def test_campus_scoped_ledger_reports_stay_empty_despite_an_unrelated_all_role(self) -> None:
        """`_ledger_report_queryset` refuses a campus scope on the campus-less ledger.
        It must read that scope from the report key's roles: read key-blind, the
        unrelated `all` role let the campus caller through to the whole tenant's P&L,
        inline and in the export file."""
        self._pay(self._invoice(due=datetime.date(2026, 9, 10)), Decimal("1000.00"))
        url = "/api/v1/reports/finance-summary?kind={}&date_from=2026-01-01&date_to=2027-01-01"
        # The control: the fixture's tenant-wide admin does see postings.
        self.assertNotEqual(self.client.get(url.format("income-vs-expense")).json()["data"], [])
        reader = UserFactory(tenant=self.tenant)
        grant(
            reader,
            "fees.report.view",
            "fees.report.export",
            scope=RecordScope.CAMPUS,
            scope_ref=self.campus.pk,
        )
        grant(reader, UNRELATED, scope=RecordScope.ALL)
        authenticate(self.client, reader)

        for kind in ("income-vs-expense", "trial-balance"):
            with self.subTest(kind=kind):
                inline = self.client.get(url.format(kind))
                self.assertEqual(inline.status_code, status.HTTP_200_OK, inline.json())
                self.assertEqual(inline.json()["data"], [])

                queued = self.client.post(
                    "/api/v1/reports/finance-summary",
                    {"kind": kind, "date_from": "2026-01-01", "date_to": "2027-01-01"},
                    format="json",
                )
                self.assertEqual(queued.status_code, status.HTTP_202_ACCEPTED, queued.json())
                job_id = queued.json()["data"]["job_id"]
                written = capture_rendered_rows(
                    lambda job_id=job_id: export_finance_report_task(
                        tenant_id=str(self.tenant.pk), job_id=job_id, actor_id=str(reader.pk)
                    )
                )
                with tenant_context(self.tenant.id):
                    job = BackgroundJob.objects.get(pk=job_id)
                self.assertEqual(job.status, JobStatus.SUCCEEDED, job.error)
                self.assertEqual(written, [])

    def test_the_export_post_stores_its_key(self) -> None:
        response = self.client.post(
            "/api/v1/reports/finance-summary",
            {"kind": "collection", "date_from": "2026-01-01", "date_to": "2027-01-01"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        self.assertEqual(
            job_payload(self.tenant, response)["scope_permission"], ["fees.report.export"]
        )


class ExamReportScopeTests(ExamReportTestCase):
    def test_each_enqueuer_stores_its_own_key(self) -> None:
        """A GET over the ceiling queues under the view key, a POST under the export key."""
        url = f"/api/v1/reports/exam-summary?kind=result-register&exam_id={self.exam.pk}"
        with mock.patch.object(exam_services, "SYNCHRONOUS_REPORT_ROW_LIMIT", 0):
            overflow = self.client.get(url)
        posted = self.client.post(
            "/api/v1/reports/exam-summary",
            {"kind": "result-register", "exam_id": str(self.exam.pk)},
            format="json",
        )

        self.assertEqual(overflow.status_code, status.HTTP_202_ACCEPTED, overflow.json())
        self.assertEqual(posted.status_code, status.HTTP_202_ACCEPTED, posted.json())
        self.assertEqual(
            job_payload(self.tenant, overflow)["scope_permission"], ["exams.result.view"]
        )
        self.assertEqual(
            job_payload(self.tenant, posted)["scope_permission"], ["exams.result.export"]
        )

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
        of its keys, and never an unrelated role's `all`. The list built from a
        mixed-type union is `test_any_of_route_unions_scopes_of_matching_roles`."""
        tenant = TenantFactory()
        user = UserFactory(tenant=tenant)
        campus_a, campus_b = uuid.uuid4(), uuid.uuid4()
        grant(user, CORRECTION_CREATE, scope=RecordScope.CAMPUS, scope_ref=campus_a)
        grant(user, CORRECTION_APPROVE, scope=RecordScope.CAMPUS, scope_ref=campus_b)
        grant(user, UNRELATED, scope=RecordScope.ALL)
        declared = AttendanceCorrectionViewSet.required_permission_map["list"]
        self.assertIsInstance(declared, AnyOf)

        scopes = scopes_for(user, declared)

        self.assertEqual(list(scopes), [RecordScope.CAMPUS])
        self.assertCountEqual(scopes[RecordScope.CAMPUS], [campus_a, campus_b])


# --- writes that resolve a target: the target's view key, then the action's ------


class NestedStaffScopeTests(StaffManagementAPITestCase):
    def test_a_staff_parent_needs_the_staff_view_scope(self) -> None:
        """`get_staff`: the qualification key tenant-wide does not reach a staff member
        the caller may read on campus A only."""
        with tenant_context(self.tenant.id):
            campus_b = CampusFactory(tenant=self.tenant)
            staff_a = StaffFactory(tenant=self.tenant, campus=self.campus)
            staff_b = StaffFactory(tenant=self.tenant, campus=campus_b)
        grant(self.user, "staff.qualification.view", scope=RecordScope.ALL)
        grant(self.user, "staff.staff.view", scope=RecordScope.CAMPUS, scope_ref=self.campus.pk)

        foreign = self.client.get(f"/api/v1/staff/{staff_b.pk}/qualifications")
        own = self.client.get(f"/api/v1/staff/{staff_a.pk}/qualifications")

        self.assertEqual(foreign.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(own.status_code, status.HTTP_200_OK, own.json())


class ThreadStudentScopeTests(ThreadAPITestCase):
    def test_a_staff_thread_needs_the_student_view_scope(self) -> None:
        """`_scoped_student`: the thread key tenant-wide does not reach a student the
        caller may only read on another campus."""
        with tenant_context(self.tenant.id):
            elsewhere = CampusFactory(tenant=self.tenant)
        staff = UserFactory(tenant=self.tenant)
        grant(staff, "communication.thread.create", scope=RecordScope.ALL)
        grant(staff, STUDENT_VIEW, scope=RecordScope.CAMPUS, scope_ref=elsewhere.pk)
        authenticate(self.client, staff)
        body = {
            "subject": "About homework",
            "thread_type": ThreadType.GUARDIAN_SCHOOL,
            "student_id": str(self.student.pk),
            "body": "Could you share this week's homework?",
        }

        refused = self.client.post("/api/v1/message-threads", body, format="json")
        grant(staff, STUDENT_VIEW, scope=RecordScope.CAMPUS, scope_ref=self.campus.pk)
        allowed = self.client.post("/api/v1/message-threads", body, format="json")

        self.assertEqual(refused.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(allowed.status_code, status.HTTP_201_CREATED, allowed.json())


class TimetableSectionScopeTests(TimetableAPITestCase):
    def test_validate_and_publish_need_the_section_view_scope(self) -> None:
        """`_scoped_section`: both action keys tenant-wide do not reach a section the
        caller may only read on another campus."""
        with tenant_context(self.tenant.id):
            elsewhere = CampusFactory(tenant=self.tenant)
        planner = UserFactory(tenant=self.tenant)
        grant(planner, "timetable.slot.view", "timetable.timetable.publish")
        grant(planner, "school.section.view", scope=RecordScope.CAMPUS, scope_ref=elsewhere.pk)
        authenticate(self.client, planner)
        base = f"/api/v1/timetables/{self.section.pk}"

        validate = self.client.post(f"{base}:validate", {}, format="json")
        publish = self.client.post(f"{base}:publish", {}, format="json")
        grant(planner, "school.section.view", scope=RecordScope.CAMPUS, scope_ref=self.campus.pk)
        control = self.client.post(f"{base}:validate", {}, format="json")

        self.assertEqual(validate.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(publish.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(control.status_code, status.HTTP_200_OK, control.json())


class CandidatesScopeTests(CoverTestCase):
    """`candidates`: the slot under the substitution key, the staff under the staff key."""

    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.elsewhere = CampusFactory(tenant=self.tenant)
        self.planner = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.planner)

    def candidates(self):
        return self.client.get(
            "/api/v1/teacher-substitutions/candidates",
            {"timetable_slot_id": str(self.slot.pk), "date": MONDAY.isoformat()},
        )

    def on(self, campus, *keys: str) -> None:
        grant(self.planner, *keys, scope=RecordScope.CAMPUS, scope_ref=campus.pk)

    def test_a_slot_outside_the_substitution_scope_is_a_404(self) -> None:
        self.on(self.elsewhere, "timetable.substitution.create")
        grant(self.planner, "staff.staff.view", scope=RecordScope.ALL)

        self.assertEqual(self.candidates().status_code, status.HTTP_404_NOT_FOUND)

    def test_only_staff_the_caller_may_read_are_offered(self) -> None:
        """The substitution key tenant-wide does not offer staff the caller may only
        read on another campus; reading this campus's staff does."""
        grant(self.planner, "timetable.substitution.create", scope=RecordScope.ALL)
        self.on(self.elsewhere, "staff.staff.view")

        unreadable = self.candidates()
        self.on(self.campus, "staff.staff.view")
        readable = self.candidates()

        self.assertEqual(unreadable.status_code, status.HTTP_200_OK, unreadable.json())
        self.assertEqual(unreadable.json()["data"], [])
        names = [row["staff_name"] for row in readable.json()["data"]]
        self.assertIn(self.cover.full_name, names)


class StaffRegisterScopeTests(StaffRegisterTestCase):
    def test_the_register_reads_the_marking_keys_scope(self) -> None:
        """The register route declares the marking key, so a tenant-wide staff view
        role does not widen a campus-scoped marker's register."""
        with tenant_context(self.tenant.id):
            elsewhere = StaffFactory(tenant=self.tenant, campus=CampusFactory(tenant=self.tenant))
        clerk = UserFactory(tenant=self.tenant)
        grant(clerk, STAFF_MARK, scope=RecordScope.CAMPUS, scope_ref=self.campus.pk)
        grant(clerk, "attendance.staff-attendance.view", scope=RecordScope.ALL)
        authenticate(self.client, clerk)

        listed = {row["staff_id"] for row in self.rows()}

        self.assertIn(str(self.zara.pk), listed)
        self.assertNotIn(str(elsewhere.pk), listed)
