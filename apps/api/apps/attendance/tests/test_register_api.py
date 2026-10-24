"""The register contract: `GET /student-attendance/register`, `my-registers`, and who may mark.

Every other attendance test marks as an `all`-scoped user. These are the ones
that act as a class teacher whose role assignments are all `assigned`, through a
real request — the path that 404'd because `scope_queryset` returns `.none()`
for `assigned` scope on a model without a `filter_assigned_to_user` hook, and
`Section` has none.
"""

from __future__ import annotations

import datetime

from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status

from apps.attendance.models import AttendanceStatus
from apps.attendance.register import may_mark_register
from apps.attendance.tests.base import (
    LAST_SESSION_DATE,
    LAST_SESSION_WINDOW,
    AttendanceAPITestCase,
)
from apps.attendance.tests.factories import (
    MARKING_DATE,
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    PeriodFactory,
    SectionFactory,
    StaffFactory,
    StudentAttendanceFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    configure_academic,
    enable_feature,
    grant,
    holiday,
)
from apps.school_organization.models import SessionStatus
from apps.student_management.models import EnrollmentStatus
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

BULK_MARK = "/api/v1/student-attendance:bulk-mark"
LIST = "/api/v1/student-attendance"
REGISTER = "/api/v1/student-attendance/register"
MY_REGISTERS = "/api/v1/student-attendance/my-registers"
REPORTS = "/api/v1/reports/attendance-summary"
MARK = "attendance.student-attendance.mark"
VIEW = "attendance.student-attendance.view"


class RegisterTestCase(AttendanceAPITestCase):
    def register_url(self, section=None, on_date=MARKING_DATE) -> str:
        return f"{REGISTER}?section_id={(section or self.section).pk}&date={on_date.isoformat()}"

    def bulk_payload(self, section=None, students=None) -> dict:
        return {
            "section_id": str((section or self.section).pk),
            "attendance_date": MARKING_DATE.isoformat(),
            "entries": [
                {"student_id": str(s.pk), "status": AttendanceStatus.PRESENT}
                for s in (students if students is not None else self.students)
            ],
        }

    def sign_in(self, user, *keys: str, scope=RecordScope.ASSIGNED, scope_ref=None) -> None:
        grant(user, *keys, scope=scope, scope_ref=scope_ref)
        authenticate(self.client, user)

    def a_teacher_of_nothing(self):
        user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            StaffFactory(tenant=self.tenant, campus=self.campus, user_id=user.pk)
        return user

    def second_campus_section(self):
        with tenant_context(self.tenant.id):
            campus = CampusFactory(tenant=self.tenant)
            section = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=campus
            )
            student = StudentFactory(tenant=self.tenant, campus=campus)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=student,
                academic_session=self.session,
                school_class=self.school_class,
                section=section,
            )
        return section, student

    def field_errors(self, response) -> set[str]:
        return {detail["field"] for detail in response.json()["error"]["details"]}

    def rows_by_student(self) -> dict[str, dict]:
        rows = self.client.get(self.register_url()).json()["data"]
        return {row["student_id"]: row for row in rows}


class AssignedScopeMarkingTests(RegisterTestCase):
    """The class teacher with `assigned` scope only — Review Focus 1."""

    def test_assigned_only_class_teacher_can_bulk_mark_over_http(self) -> None:
        """Was a 404: the section resolved through `scope_queryset`, `.none()` here."""
        self.sign_in(self.teacher_user, MARK)

        response = self.client.post(BULK_MARK, self.bulk_payload(), format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["meta"]["marked"], len(self.students))

    def test_assigned_only_class_teacher_can_read_their_register(self) -> None:
        self.sign_in(self.teacher_user, MARK)

        response = self.client.get(self.register_url())

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(len(response.json()["data"]), len(self.students))

    def test_a_non_class_teacher_is_refused_with_422_on_bulk_mark(self) -> None:
        self.sign_in(self.a_teacher_of_nothing(), MARK)

        response = self.client.post(BULK_MARK, self.bulk_payload(), format="json")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("section_id", self.field_errors(response))

    def test_a_non_class_teacher_gets_404_on_the_register(self) -> None:
        self.sign_in(self.a_teacher_of_nothing(), MARK)

        response = self.client.get(self.register_url())

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_own_scope_alone_cannot_read_a_register(self) -> None:
        """The class-teacher path needs `assigned`; `own` marks nothing (§5)."""
        self.sign_in(self.teacher_user, MARK, scope=RecordScope.OWN)

        self.assertEqual(
            self.client.get(self.register_url()).status_code, status.HTTP_404_NOT_FOUND
        )


class CampusScopeMarkingTests(RegisterTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.far_section, self.far_student = self.second_campus_section()
        self.marker = UserFactory(tenant=self.tenant)
        self.sign_in(self.marker, MARK, scope=RecordScope.CAMPUS, scope_ref=self.campus.pk)

    def test_a_campus_marker_reads_their_own_campus_register(self) -> None:
        self.assertEqual(self.client.get(self.register_url()).status_code, status.HTTP_200_OK)

    def test_another_campus_register_is_a_404(self) -> None:
        response = self.client.get(self.register_url(section=self.far_section))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_marking_another_campus_section_is_a_404(self) -> None:
        payload = self.bulk_payload(section=self.far_section, students=[self.far_student])

        response = self.client.post(BULK_MARK, payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_the_predicate_refuses_another_campus_on_its_own(self) -> None:
        """`may_mark_register` holds the campus line itself, not only the view's lookup."""
        with tenant_context(self.tenant.id):
            self.assertTrue(
                may_mark_register(
                    user=self.marker, section=self.section, on_date=MARKING_DATE, period=None
                )
            )
            self.assertFalse(
                may_mark_register(
                    user=self.marker, section=self.far_section, on_date=MARKING_DATE, period=None
                )
            )


class MixedScopeMarkingTests(RegisterTestCase):
    """A campus role and an `assigned` role together reach every section either grants."""

    def setUp(self) -> None:
        super().setUp()
        self.far_section, self.far_student = self.second_campus_section()
        with tenant_context(self.tenant.id):
            self.far_section.class_teacher_staff_id = self.teacher.pk
            self.far_section.save(update_fields=["class_teacher_staff_id", "updated_at"])

    def assert_every_route_agrees(self) -> None:
        self.assertEqual(
            self.client.get(self.register_url(section=self.far_section)).status_code,
            status.HTTP_200_OK,
        )
        payload = self.bulk_payload(section=self.far_section, students=[self.far_student])
        response = self.client.post(BULK_MARK, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        listed = {row["section_id"] for row in self.client.get(MY_REGISTERS).json()["data"]}
        self.assertIn(str(self.far_section.pk), listed)

    def test_campus_a_plus_assigned_marks_the_section_they_class_teach_on_campus_b(self) -> None:
        grant(self.teacher_user, MARK, scope=RecordScope.CAMPUS, scope_ref=self.campus.pk)
        self.sign_in(self.teacher_user, MARK)

        self.assert_every_route_agrees()

    def test_a_campus_role_with_no_campus_plus_assigned_still_marks_their_section(self) -> None:
        grant(self.teacher_user, MARK, scope=RecordScope.CAMPUS, scope_ref=None)
        self.sign_in(self.teacher_user, MARK)

        self.assert_every_route_agrees()

    def test_a_campus_role_with_no_campus_alone_reaches_nothing(self) -> None:
        self.sign_in(UserFactory(tenant=self.tenant), MARK, scope=RecordScope.CAMPUS)

        self.assertEqual(
            self.client.get(self.register_url()).status_code, status.HTTP_404_NOT_FOUND
        )
        response = self.client.post(BULK_MARK, self.bulk_payload(), format="json")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class RegisterGatingTests(RegisterTestCase):
    def test_the_view_key_alone_cannot_read_the_register(self) -> None:
        self.sign_in(UserFactory(tenant=self.tenant), VIEW, scope=RecordScope.ALL)

        self.assertEqual(
            self.client.get(self.register_url()).status_code, status.HTTP_403_FORBIDDEN
        )
        self.assertEqual(self.client.get(MY_REGISTERS).status_code, status.HTTP_403_FORBIDDEN)

    def test_a_restricted_principal_is_refused_even_holding_the_mark_key(self) -> None:
        user = UserFactory(tenant=self.tenant)
        grant(user, MARK, scope=RecordScope.ALL, is_restricted_principal=True)
        authenticate(self.client, user)

        self.assertEqual(
            self.client.get(self.register_url()).status_code, status.HTTP_403_FORBIDDEN
        )
        self.assertEqual(self.client.get(MY_REGISTERS).status_code, status.HTTP_403_FORBIDDEN)

    def test_a_missing_date_is_a_field_error(self) -> None:
        self.sign_in(self.user, MARK, scope=RecordScope.ALL)

        response = self.client.get(f"{REGISTER}?section_id={self.section.pk}")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("date", self.field_errors(response))


class RegisterContentTests(RegisterTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.sign_in(self.user, MARK, scope=RecordScope.ALL)

    def set_roll(self, student, roll: str | None, first_name: str) -> None:
        with tenant_context(self.tenant.id):
            student.first_name = first_name
            student.save(update_fields=["first_name", "updated_at"])
            enrollment = student.enrollments.get()
            enrollment.roll_number = roll
            enrollment.save(update_fields=["roll_number", "updated_at"])

    def test_the_roster_is_in_roll_order_then_name_with_unnumbered_last(self) -> None:
        """Roll numbers are text, so "10" must not sort before "2"."""
        ten, two, unnumbered = self.students
        self.set_roll(ten, "10", "Bilal")
        self.set_roll(two, "2", "Zainab")
        self.set_roll(unnumbered, None, "Hira")

        rows = self.client.get(self.register_url()).json()["data"]

        self.assertEqual(
            [row["student_id"] for row in rows], [str(two.pk), str(ten.pk), str(unnumbered.pk)]
        )
        self.assertEqual([row["roll_number"] for row in rows], ["2", "10", None])

    def test_unnumbered_students_are_ordered_by_name(self) -> None:
        first, second, third = self.students
        self.set_roll(first, None, "Zainab")
        self.set_roll(second, None, "Bilal")
        self.set_roll(third, None, "Imran")

        rows = self.client.get(self.register_url()).json()["data"]

        self.assertEqual(
            [row["student_name"] for row in rows], ["Bilal Test", "Imran Test", "Zainab Test"]
        )

    def test_an_existing_record_is_merged_and_the_rest_are_null(self) -> None:
        with tenant_context(self.tenant.id):
            StudentAttendanceFactory(
                tenant=self.tenant,
                student=self.students[0],
                section=self.section,
                academic_session=self.session,
                status=AttendanceStatus.ABSENT,
                marked_by=self.user.pk,
            )

        rows = self.rows_by_student()

        self.assertEqual(
            rows[str(self.students[0].pk)]["record"]["status"], AttendanceStatus.ABSENT
        )
        self.assertIsNone(rows[str(self.students[1].pk)]["record"])

    def test_on_leave_is_set_from_the_daily_on_leave_row(self) -> None:
        with tenant_context(self.tenant.id):
            StudentAttendanceFactory(
                tenant=self.tenant,
                student=self.students[1],
                section=self.section,
                academic_session=self.session,
                status=AttendanceStatus.ON_LEAVE,
                marked_by=self.user.pk,
            )

        rows = self.rows_by_student()

        self.assertTrue(rows[str(self.students[1].pk)]["on_leave"])
        self.assertFalse(rows[str(self.students[0].pk)]["on_leave"])

    def test_a_deleted_student_and_an_inactive_enrollment_are_absent(self) -> None:
        deleted, withdrawn, kept = self.students
        with tenant_context(self.tenant.id):
            deleted.deleted_at = timezone.now()
            deleted.save(update_fields=["deleted_at"])
            enrollment = withdrawn.enrollments.get()
            enrollment.status = EnrollmentStatus.WITHDRAWN
            enrollment.save(update_fields=["status"])

        rows = self.client.get(self.register_url()).json()["data"]

        self.assertEqual([row["student_id"] for row in rows], [str(kept.pk)])

    def test_the_rows_carry_the_names_a_register_shows(self) -> None:
        row = self.client.get(self.register_url()).json()["data"][0]

        student = next(s for s in self.students if str(s.pk) == row["student_id"])
        self.assertEqual(row["student_name"], f"{student.first_name} {student.last_name}")
        self.assertEqual(row["admission_number"], student.admission_number)

    def test_an_own_period_is_refused_in_daily_mode(self) -> None:
        """One mode at a time (ADR-0028); the period-mode register is in test_attendance_mode."""
        response = self.client.get(f"{self.register_url()}&period_id={self.period.pk}")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("period_id", self.field_errors(response))

    def test_an_unknown_period_is_a_404(self) -> None:
        unknown = "0f3b4a1e-0000-4000-8000-000000000000"

        response = self.client.get(f"{self.register_url()}&period_id={unknown}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_the_date_picks_the_session_that_contains_it(self) -> None:
        """A date in last session's lock window reads last session's roster."""
        with tenant_context(self.tenant.id):
            last = AcademicSessionFactory(
                tenant=self.tenant,
                **LAST_SESSION_WINDOW,
            )
            alumnus = StudentFactory(tenant=self.tenant, campus=self.campus)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=alumnus,
                academic_session=last,
                school_class=self.school_class,
                section=self.section,
            )

        body = self.client.get(self.register_url(on_date=LAST_SESSION_DATE)).json()

        self.assertEqual([row["student_id"] for row in body["data"]], [str(alumnus.pk)])
        self.assertEqual(body["meta"]["academic_session_id"], str(last.pk))


class RegisterMetaTests(RegisterTestCase):
    """`meta.markable` is false, with a reason, wherever a submission would be refused."""

    def setUp(self) -> None:
        super().setUp()
        self.sign_in(self.user, MARK, scope=RecordScope.ALL)

    def meta(self, on_date=MARKING_DATE) -> dict:
        response = self.client.get(self.register_url(on_date=on_date))
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return response.json()["meta"]

    def test_today_is_markable_in_daily_mode(self) -> None:
        meta = self.meta()

        self.assertEqual(meta["attendance_mode"], "daily")
        self.assertTrue(meta["markable"])
        self.assertIsNone(meta["unmarkable_reason"])
        self.assertFalse(meta["is_locked"])

    def test_a_future_date_is_not_markable(self) -> None:
        meta = self.meta(MARKING_DATE + datetime.timedelta(days=1))

        self.assertFalse(meta["markable"])
        self.assertEqual(meta["unmarkable_reason"], "future")

    def test_a_holiday_is_not_markable_and_is_named(self) -> None:
        configure_academic(
            self.tenant, holidays=[holiday(MARKING_DATE.isoformat(), "Founders Day")]
        )

        meta = self.meta()

        self.assertEqual(meta["unmarkable_reason"], "holiday")
        self.assertEqual(meta["holiday_name"], "Founders Day")

    def test_a_non_working_day_is_not_markable(self) -> None:
        configure_academic(
            self.tenant, working_days=[day for day in range(7) if day != MARKING_DATE.weekday()]
        )

        self.assertEqual(self.meta()["unmarkable_reason"], "non_working_day")

    def test_a_date_past_the_lock_window_stays_markable_because_the_lock_is_per_row(self) -> None:
        """A first mark of a past working day is accepted; only existing rows lock."""
        meta = self.meta(MARKING_DATE - datetime.timedelta(days=1))

        self.assertTrue(meta["is_locked"])
        self.assertTrue(meta["markable"])
        self.assertIsNone(meta["unmarkable_reason"])

    def test_a_closed_session_is_not_markable(self) -> None:
        """`assert_session_writable` would refuse every row, so the register says so."""
        with tenant_context(self.tenant.id):
            AcademicSessionFactory(
                tenant=self.tenant,
                **LAST_SESSION_WINDOW,
                status=SessionStatus.CLOSED,
            )

        meta = self.meta(LAST_SESSION_DATE)

        self.assertFalse(meta["markable"])
        self.assertEqual(meta["unmarkable_reason"], "session_closed")

    def test_an_unknown_mode_falls_back_to_daily(self) -> None:
        configure_academic(self.tenant, attendance_mode="hourly")

        self.assertEqual(self.meta()["attendance_mode"], "daily")


class MyRegistersTests(RegisterTestCase):
    def test_an_all_scoped_class_teacher_gets_their_own_sections(self) -> None:
        """From the caller's own staff rows whatever their scope: not empty, not everything."""
        self.sign_in(self.teacher_user, MARK, scope=RecordScope.ALL)

        response = self.client.get(f"{MY_REGISTERS}?date={MARKING_DATE.isoformat()}")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        rows = response.json()["data"]
        self.assertEqual([row["section_id"] for row in rows], [str(self.section.pk)])
        row = rows[0]
        self.assertEqual(row["section_name"], self.section.name)
        self.assertEqual(row["class_name"], self.school_class.name)
        self.assertEqual(row["campus_id"], str(self.campus.pk))
        self.assertIsNone(row["period_id"])
        self.assertIsNone(row["start_time"])
        self.assertEqual(row["roster_count"], len(self.students))
        self.assertEqual(row["marked_count"], 0)

    def test_an_assigned_only_class_teacher_gets_their_section(self) -> None:
        self.sign_in(self.teacher_user, MARK)

        rows = self.client.get(MY_REGISTERS).json()["data"]

        self.assertEqual([row["section_id"] for row in rows], [str(self.section.pk)])

    def test_marked_count_follows_the_register(self) -> None:
        self.sign_in(self.teacher_user, MARK)
        self.client.post(BULK_MARK, self.bulk_payload(students=self.students[:2]), format="json")

        row = self.client.get(MY_REGISTERS).json()["data"][0]

        self.assertEqual((row["marked_count"], row["roster_count"]), (2, len(self.students)))

    def test_an_admin_with_no_staff_row_has_no_registers(self) -> None:
        self.sign_in(self.user, MARK, scope=RecordScope.ALL)

        self.assertEqual(self.client.get(MY_REGISTERS).json()["data"], [])

    def test_sections_are_ordered_by_name(self) -> None:
        with tenant_context(self.tenant.id):
            self.section.name = "B"
            self.section.save(update_fields=["name", "updated_at"])
            first = SectionFactory(
                tenant=self.tenant,
                school_class=self.school_class,
                campus=self.campus,
                name="A",
                class_teacher_staff_id=self.teacher.pk,
            )
        self.sign_in(self.teacher_user, MARK)

        ids = [row["section_id"] for row in self.client.get(MY_REGISTERS).json()["data"]]

        self.assertEqual(ids, [str(first.pk), str(self.section.pk)])


class StudentAttendanceNamesAndScopeTests(RegisterTestCase):
    def mark_in(self, section, student, marked_by):
        with tenant_context(self.tenant.id):
            return StudentAttendanceFactory(
                tenant=self.tenant,
                student=student,
                section=section,
                academic_session=self.session,
                marked_by=marked_by.pk,
            )

    def test_the_list_carries_names(self) -> None:
        self.sign_in(self.user, VIEW, scope=RecordScope.ALL)
        self.mark_in(self.section, self.students[0], self.user)

        row = self.client.get(LIST).json()["data"][0]

        student = self.students[0]
        self.assertEqual(row["student_name"], f"{student.first_name} {student.last_name}")
        self.assertEqual(row["admission_number"], student.admission_number)
        self.assertEqual(row["section_name"], self.section.name)
        self.assertIsNone(row["period_name"])

    def test_the_period_name_is_carried_for_a_period_row(self) -> None:
        self.sign_in(self.user, VIEW, scope=RecordScope.ALL)
        with tenant_context(self.tenant.id):
            StudentAttendanceFactory(
                tenant=self.tenant,
                student=self.students[0],
                section=self.section,
                academic_session=self.session,
                period=self.period,
                marked_by=self.user.pk,
            )

        row = self.client.get(LIST).json()["data"][0]

        self.assertEqual(row["period_name"], self.period.name)

    def test_a_teacher_reads_a_row_they_marked_outside_their_sections(self) -> None:
        """A slot teacher or substitute must see and correct what they marked (L4)."""
        with tenant_context(self.tenant.id):
            visitor = StudentFactory(tenant=self.tenant, campus=self.campus)
        mine = self.mark_in(self.other_section, visitor, self.teacher_user)
        theirs = self.mark_in(self.other_section, self.students[0], self.user)
        self.sign_in(self.teacher_user, VIEW)

        listed = {row["id"] for row in self.client.get(LIST).json()["data"]}

        self.assertIn(str(mine.pk), listed)
        self.assertNotIn(str(theirs.pk), listed)
        self.assertEqual(self.client.get(f"{LIST}/{mine.pk}").status_code, status.HTTP_200_OK)
        self.assertEqual(
            self.client.get(f"{LIST}/{theirs.pk}").status_code, status.HTTP_404_NOT_FOUND
        )


class ReportScopeTests(RegisterTestCase):
    """Reports do not take the `marked_by` widening record reads get."""

    def test_a_row_marked_elsewhere_is_listed_but_not_reported(self) -> None:
        with tenant_context(self.tenant.id):
            visitor = StudentFactory(tenant=self.tenant, campus=self.campus)
            for student, section, marker in (
                (visitor, self.other_section, self.teacher_user),
                (self.students[0], self.section, self.user),
            ):
                StudentAttendanceFactory(
                    tenant=self.tenant,
                    student=student,
                    section=section,
                    academic_session=self.session,
                    marked_by=marker.pk,
                )
        self.sign_in(self.teacher_user, VIEW, "attendance.report.view")

        listed = {row["student_id"] for row in self.client.get(LIST).json()["data"]}
        response = self.client.get(
            f"{REPORTS}?kind=student-summary&start_date={MARKING_DATE}&end_date={MARKING_DATE}"
        )

        self.assertIn(str(visitor.pk), listed)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        reported = {row["student_id"] for row in response.json()["data"]}
        self.assertEqual(reported, {str(self.students[0].pk)})


class BulkMarkSessionTests(RegisterTestCase):
    def test_a_past_date_with_no_session_named_marks_into_the_session_containing_it(self) -> None:
        with tenant_context(self.tenant.id):
            last = AcademicSessionFactory(
                tenant=self.tenant,
                **LAST_SESSION_WINDOW,
            )
            alumnus = StudentFactory(tenant=self.tenant, campus=self.campus)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=alumnus,
                academic_session=last,
                school_class=self.school_class,
                section=self.section,
            )
        self.sign_in(self.user, MARK, scope=RecordScope.ALL)
        payload = {
            **self.bulk_payload(students=[alumnus]),
            "attendance_date": LAST_SESSION_DATE.isoformat(),
        }

        response = self.client.post(BULK_MARK, payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"][0]["academic_session_id"], str(last.pk))


class FlatQueryTests(RegisterTestCase):
    """Each new read costs the same number of queries for one row as for many."""

    def count(self, url: str) -> int:
        with CaptureQueriesContext(connection) as captured:
            response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return len(captured)

    def enrol_and_mark(self, section, how_many: int) -> None:
        with tenant_context(self.tenant.id):
            for _ in range(how_many):
                student = StudentFactory(tenant=self.tenant, campus=self.campus)
                StudentEnrollmentFactory(
                    tenant=self.tenant,
                    student=student,
                    academic_session=self.session,
                    school_class=self.school_class,
                    section=section,
                )
                StudentAttendanceFactory(
                    tenant=self.tenant,
                    student=student,
                    section=section,
                    academic_session=self.session,
                    marked_by=self.user.pk,
                )

    def test_the_register_costs_no_query_per_student(self) -> None:
        self.sign_in(self.user, MARK, scope=RecordScope.ALL)
        self.enrol_and_mark(self.section, 1)
        self.count(self.register_url())  # warm the per-user permission caches
        before = self.count(self.register_url())

        self.enrol_and_mark(self.section, 4)

        self.assertEqual(self.count(self.register_url()), before)

    def test_my_registers_costs_no_query_per_section(self) -> None:
        self.sign_in(self.teacher_user, MARK)
        self.count(MY_REGISTERS)
        before = self.count(MY_REGISTERS)

        for _ in range(3):
            with tenant_context(self.tenant.id):
                section = SectionFactory(
                    tenant=self.tenant,
                    school_class=self.school_class,
                    campus=self.campus,
                    class_teacher_staff_id=self.teacher.pk,
                )
            self.enrol_and_mark(section, 2)

        self.assertEqual(self.count(MY_REGISTERS), before)

    def test_the_list_names_cost_no_query_per_row(self) -> None:
        self.sign_in(self.user, VIEW, scope=RecordScope.ALL)
        self.enrol_and_mark(self.section, 1)
        self.count(LIST)
        before = self.count(LIST)

        self.enrol_and_mark(self.section, 4)

        self.assertEqual(self.count(LIST), before)

    def test_the_bulk_mark_response_reads_students_once(self) -> None:
        """Only the student reads: each row also writes an audit entry, by design."""
        self.sign_in(self.user, MARK, scope=RecordScope.ALL)

        def student_reads(students) -> int:
            with CaptureQueriesContext(connection) as captured:
                response = self.client.post(
                    BULK_MARK, self.bulk_payload(students=students), format="json"
                )
            self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
            return sum('FROM "students"' in query["sql"] for query in captured.captured_queries)

        self.assertEqual(student_reads(self.students[:1]), student_reads(self.students))


class RegisterCrossTenantTests(RegisterTestCase):
    """AGENTS.md invariant 2: another tenant's section is a 404, never a 403."""

    def setUp(self) -> None:
        super().setUp()
        self.other = TenantFactory()
        enable_feature(self.other, "module.attendance")
        with tenant_context(self.other.id):
            campus = CampusFactory(tenant=self.other)
            AcademicSessionFactory(tenant=self.other, is_current=True)
            # A foreign section naming *our* teacher's staff id as its class teacher:
            # `class_teacher_staff_id` is a bare UUID, so only tenant isolation hides it.
            self.foreign_section = SectionFactory(
                tenant=self.other,
                school_class=ClassFactory(tenant=self.other, level=6),
                campus=campus,
                class_teacher_staff_id=self.teacher.pk,
            )

    def test_another_tenants_register_is_a_404(self) -> None:
        self.sign_in(self.user, MARK, scope=RecordScope.ALL)

        response = self.client.get(self.register_url(section=self.foreign_section))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_another_tenants_register_is_a_404_for_an_assigned_teacher_too(self) -> None:
        """The assigned path resolves through the alive manager, not `scope_queryset`."""
        self.sign_in(self.teacher_user, MARK)

        response = self.client.get(self.register_url(section=self.foreign_section))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_another_tenants_period_is_a_404(self) -> None:
        with tenant_context(self.other.id):
            foreign_period = PeriodFactory(tenant=self.other, sequence=1)
        self.sign_in(self.user, MARK, scope=RecordScope.ALL)

        response = self.client.get(f"{self.register_url()}&period_id={foreign_period.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_my_registers_never_lists_another_tenants_section(self) -> None:
        self.sign_in(self.teacher_user, MARK)

        rows = self.client.get(MY_REGISTERS).json()["data"]

        self.assertEqual([row["section_id"] for row in rows], [str(self.section.pk)])
