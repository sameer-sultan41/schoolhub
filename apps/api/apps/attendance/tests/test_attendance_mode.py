"""Period mode (ADR-0028): the setting, the gate, who marks, leave, lateness, alerts.

The base fixture puts the tenant in period mode and gives `self.section` three
lessons today (P1-P3, all taught by `self.slot_teacher`). P4 has no lesson and
`self.recess` is a break. `self.teacher` (from the module base) is the section's
class teacher and teaches none of its lessons. Markers act with `assigned` scope
unless a test says otherwise — the path every older test skipped (Review Focus 1).
"""

from __future__ import annotations

import datetime
from decimal import Decimal
from unittest import mock

from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework import status

from apps.attendance import register, reports, services
from apps.attendance.models import AttendanceSource, AttendanceStatus, StudentAttendance
from apps.attendance.tests.base import LAST_SESSION_WINDOW, AttendanceAPITestCase
from apps.attendance.tests.factories import (
    MARKING_DATE,
    AcademicSessionFactory,
    CampusFactory,
    PeriodFactory,
    SectionFactory,
    StaffFactory,
    StudentAttendanceFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    configure_academic,
    disable_feature,
    enable_feature,
    grant,
)
from apps.timetable.models import SlotStatus, SubstitutionStatus
from apps.timetable.tests.factories import TeacherSubstitutionFactory, TimetableSlotFactory
from core.api.exceptions import DomainRuleViolation
from core.audit.models import AuditLog
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context
from core.tenancy.models import TenantSettings

BULK_MARK = "/api/v1/student-attendance:bulk-mark"
REGISTER = "/api/v1/student-attendance/register"
MY_REGISTERS = "/api/v1/student-attendance/my-registers"
SETTINGS = "/api/v1/attendance-settings"
REPORTS = "/api/v1/reports/attendance-summary"
MARK = "attendance.student-attendance.mark"
SETTINGS_VIEW = "school.settings.view"
SETTINGS_UPDATE = "school.settings.update"


class ModeTestCase(AttendanceAPITestCase):
    def field_errors(self, response) -> set[str]:
        return {detail["field"] for detail in response.json()["error"]["details"]}

    def sign_in(self, user, *keys: str, scope=RecordScope.ASSIGNED, scope_ref=None) -> None:
        grant(user, *keys, scope=scope, scope_ref=scope_ref)
        authenticate(self.client, user)

    def staff_user(self, campus=None):
        user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=campus or self.campus, user_id=user.pk)
        return user, staff

    def publish(self, period, staff, *, on_date=MARKING_DATE, section=None, **window):
        with tenant_context(self.tenant.id):
            return TimetableSlotFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=section or self.section,
                period=period,
                staff=staff,
                day_of_week=on_date.weekday(),
                status=SlotStatus.PUBLISHED,
                **window,
            )

    def payload(self, period=None, *, status_value=AttendanceStatus.PRESENT, students=None):
        body = {
            "section_id": str(self.section.pk),
            "attendance_date": MARKING_DATE.isoformat(),
            "entries": [
                {"student_id": str(s.pk), "status": status_value}
                for s in (students if students is not None else self.students)
            ],
        }
        if period is not None:
            body["period_id"] = str(period.pk)
        return body

    def bulk(self, period=None, **kwargs):
        return self.client.post(BULK_MARK, self.payload(period, **kwargs), format="json")

    def register_url(self, period=None) -> str:
        url = f"{REGISTER}?section_id={self.section.pk}&date={MARKING_DATE.isoformat()}"
        return f"{url}&period_id={period.pk}" if period is not None else url


class PeriodModeTestCase(ModeTestCase):
    def setUp(self) -> None:
        super().setUp()
        configure_academic(
            self.tenant,
            attendance_mode="period",
            day_window={"start": "08:00", "end": "14:00", "grace_minutes": 10},
        )
        enable_feature(self.tenant, services.TIMETABLE_FEATURE)
        self.slot_user, self.slot_teacher = self.staff_user()
        self.p1, self.p2, self.p3, self.p4 = self.periods
        self.lessons = {
            period.pk: self.publish(period, self.slot_teacher) for period in self.periods[:3]
        }
        with tenant_context(self.tenant.id):
            self.recess = PeriodFactory(tenant=self.tenant, sequence=5, is_break=True)

    def cover(self, period, substitute, *, status_value=SubstitutionStatus.CONFIRMED):
        with tenant_context(self.tenant.id):
            return TeacherSubstitutionFactory(
                tenant=self.tenant,
                timetable_slot=self.lessons[period.pk],
                date=MARKING_DATE,
                absent_staff=self.slot_teacher,
                substitute_staff=substitute,
                status=status_value,
            )

    def mark(self, period, entries) -> dict:
        with tenant_context(self.tenant.id):
            return services.bulk_mark_student_attendance(
                section=self.section,
                session=self.session,
                on_date=MARKING_DATE,
                period=period,
                entries=entries,
                actor_id=self.user.pk,
            )


# ---------------------------------------------------------------------------
# The setting
# ---------------------------------------------------------------------------


class AttendanceModeReaderTests(ModeTestCase):
    def mode(self) -> str:
        with tenant_context(self.tenant.id):
            return services.attendance_mode()

    def test_the_default_is_daily(self) -> None:
        self.assertEqual(self.mode(), "daily")

    def test_an_unknown_value_is_daily(self) -> None:
        configure_academic(self.tenant, attendance_mode="hourly")

        self.assertEqual(self.mode(), "daily")

    def test_period_is_read(self) -> None:
        configure_academic(self.tenant, attendance_mode="period")

        self.assertEqual(self.mode(), "period")


class AttendanceSettingsTests(ModeTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.sign_in(self.user, SETTINGS_VIEW, SETTINGS_UPDATE, scope=RecordScope.ALL)

    def academic(self) -> dict:
        with tenant_context(self.tenant.id):
            return TenantSettings.objects.get(tenant=self.tenant).academic

    def test_the_defaults_are_read_when_nothing_is_configured(self) -> None:
        response = self.client.get(SETTINGS)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(
            response.json()["data"],
            {
                "attendance_mode": "daily",
                "lock_window_days": services.DEFAULT_LOCK_WINDOW_DAYS,
                "leave_escalation_threshold_days": services.DEFAULT_ESCALATION_THRESHOLD_DAYS,
            },
        )

    def test_a_patch_round_trips_and_the_module_reads_it(self) -> None:
        enable_feature(self.tenant, "module.timetable")
        body = {
            "attendance_mode": "period",
            "lock_window_days": 3,
            "leave_escalation_threshold_days": 4,
        }

        patched = self.client.patch(SETTINGS, body, format="json")

        self.assertEqual(patched.status_code, status.HTTP_200_OK, patched.json())
        self.assertEqual(patched.json()["data"], body)
        self.assertEqual(self.client.get(SETTINGS).json()["data"], body)
        with tenant_context(self.tenant.id):
            self.assertEqual(services.attendance_mode(), "period")
            self.assertEqual(services.lock_window_days(), 3)
            self.assertEqual(services.escalation_threshold_days(), 4)

    def test_sibling_academic_keys_and_the_nested_dicts_other_keys_survive(self) -> None:
        configure_academic(
            self.tenant,
            holidays=[{"start_date": "2026-12-25", "name": "Winter break"}],
            student_leave_approval={"escalation_threshold_days": 10, "notify_principal": True},
        )
        before = self.academic()

        response = self.client.patch(
            SETTINGS, {"leave_escalation_threshold_days": 6}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        after = self.academic()
        self.assertEqual(after["working_days"], before["working_days"])
        self.assertEqual(after["holidays"], before["holidays"])
        self.assertEqual(
            after["student_leave_approval"],
            {"escalation_threshold_days": 6, "notify_principal": True},
        )
        self.assertNotIn("attendance_mode", after)

    def test_out_of_bounds_values_are_refused(self) -> None:
        for body in (
            {"lock_window_days": services.MAX_LOCK_WINDOW_DAYS + 1},
            {"lock_window_days": -1},
            {"leave_escalation_threshold_days": 0},
            {"attendance_mode": "hourly"},
        ):
            with self.subTest(body=body):
                response = self.client.patch(SETTINGS, body, format="json")

                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
                self.assertEqual(self.field_errors(response), set(body))

    def test_period_mode_is_refused_while_the_timetable_is_off(self) -> None:
        response = self.client.patch(SETTINGS, {"attendance_mode": "period"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("attendance_mode", self.field_errors(response))
        self.assertNotIn("attendance_mode", self.academic())

    def test_daily_mode_needs_no_timetable(self) -> None:
        response = self.client.patch(SETTINGS, {"attendance_mode": "daily"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

    def test_a_change_is_audited_with_before_and_after(self) -> None:
        self.client.patch(SETTINGS, {"lock_window_days": 2}, format="json")

        with tenant_context(self.tenant.id):
            row = TenantSettings.objects.get(tenant=self.tenant)
            entry = AuditLog.objects.get(action="update", resource_id=row.pk)
        self.assertEqual(entry.before["lock_window_days"], 0)
        self.assertEqual(entry.after["lock_window_days"], 2)


class AttendanceSettingsQueryTests(ModeTestCase):
    """The endpoint's own database work, beneath the request's auth and tenancy overhead."""

    def test_a_read_is_one_query(self) -> None:
        with tenant_context(self.tenant.id), self.assertNumQueries(1):
            settings = services.read_attendance_settings(tenant_id=self.tenant.pk)

        self.assertEqual(settings["attendance_mode"], "daily")

    def test_a_write_is_the_locked_read_and_the_update(self) -> None:
        with tenant_context(self.tenant.id), self.assertNumQueries(2):
            _, before, after = services.update_attendance_settings(
                tenant_id=self.tenant.pk,
                changes={"lock_window_days": 3, "leave_escalation_threshold_days": 4},
                actor_id=self.user.pk,
            )

        self.assertNotIn("attendance_lock_window_days", before)
        self.assertEqual(after["attendance_lock_window_days"], 3)
        self.assertEqual(after["student_leave_approval"], {"escalation_threshold_days": 4})

    def test_the_endpoint_reads_its_row_once_and_writes_it_once(self) -> None:
        """Pinned per table over real requests.

        A request also authenticates, binds the tenant, and checks the feature
        flag and the permission keys; those are the request's overhead, cached
        per user after the warm-up call, not this endpoint's work. What the
        endpoint itself costs is pinned exactly: the settings row, the write and
        the audit entry.
        """
        self.sign_in(self.user, SETTINGS_VIEW, SETTINGS_UPDATE, scope=RecordScope.ALL)
        self.client.get(SETTINGS)  # Warm the per-user permission and feature caches.

        with CaptureQueriesContext(connection) as read:
            response = self.client.get(SETTINGS)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        with CaptureQueriesContext(connection) as written:
            response = self.client.patch(SETTINGS, {"lock_window_days": 2}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        def touching(captured, needle: str) -> int:
            return sum(needle in query["sql"] for query in captured.captured_queries)

        # GET: the settings row, read once; nothing written.
        self.assertEqual(touching(read, '"tenant_settings"'), 1)
        self.assertEqual(touching(read, '"audit_logs"'), 0)
        # PATCH: the row read once, under its lock; updated once; one audit entry.
        self.assertEqual(touching(written, '"tenant_settings"'), 2)
        self.assertEqual(touching(written, "FOR UPDATE"), 1)
        self.assertEqual(touching(written, 'UPDATE "tenant_settings"'), 1)
        self.assertEqual(touching(written, 'INSERT INTO "audit_logs"'), 1)


class AttendanceSettingsKeyTests(ModeTestCase):
    def test_the_view_key_reads_but_cannot_write(self) -> None:
        self.sign_in(self.user, SETTINGS_VIEW, scope=RecordScope.ALL)

        self.assertEqual(self.client.get(SETTINGS).status_code, status.HTTP_200_OK)
        self.assertEqual(
            self.client.patch(SETTINGS, {"lock_window_days": 1}, format="json").status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_no_settings_key_reads_nothing(self) -> None:
        self.sign_in(self.user, MARK, scope=RecordScope.ALL)

        self.assertEqual(self.client.get(SETTINGS).status_code, status.HTTP_403_FORBIDDEN)

    def test_a_restricted_principal_is_refused(self) -> None:
        grant(self.user, SETTINGS_VIEW, scope=RecordScope.ALL, is_restricted_principal=True)

        self.assertEqual(self.client.get(SETTINGS).status_code, status.HTTP_403_FORBIDDEN)


# ---------------------------------------------------------------------------
# The gate: one mode at a time, lessons only
# ---------------------------------------------------------------------------


class WrongShapeTests(PeriodModeTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.sign_in(self.user, MARK, scope=RecordScope.ALL)

    def assert_period_refused(self, response) -> None:
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("period_id", self.field_errors(response))

    def test_period_mode_needs_a_period(self) -> None:
        self.assert_period_refused(self.bulk())
        self.assert_period_refused(self.client.get(self.register_url()))

    def test_daily_mode_refuses_a_period(self) -> None:
        configure_academic(self.tenant, attendance_mode="daily")

        self.assert_period_refused(self.bulk(self.p1))

    def test_the_service_holds_the_gate_in_each_mode(self) -> None:
        """The importer and leave do not pass through the view, so the rule lives below it."""
        entries = [{"student_id": self.students[0].pk, "status": AttendanceStatus.PRESENT}]
        with self.assertRaises(DomainRuleViolation):
            self.mark(None, entries)
        configure_academic(self.tenant, attendance_mode="daily")
        with self.assertRaises(DomainRuleViolation):
            self.mark(self.p1, entries)

    def test_a_break_is_refused(self) -> None:
        self.assert_period_refused(self.bulk(self.recess))
        self.assert_period_refused(self.client.get(self.register_url(self.recess)))

    def test_a_period_with_no_lesson_that_day_is_refused(self) -> None:
        self.assert_period_refused(self.bulk(self.p4))
        self.assert_period_refused(self.client.get(self.register_url(self.p4)))

    def test_a_lesson_on_another_weekday_is_not_a_lesson_today(self) -> None:
        self.publish(self.p4, self.slot_teacher, on_date=MARKING_DATE + datetime.timedelta(days=1))

        self.assert_period_refused(self.bulk(self.p4))

    def test_a_lesson_is_accepted_and_its_register_read(self) -> None:
        self.assertEqual(self.bulk(self.p1).status_code, status.HTTP_200_OK)

        response = self.client.get(self.register_url(self.p1))

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["meta"]["attendance_mode"], "period")
        records = [row["record"] for row in response.json()["data"]]
        self.assertTrue(all(record["period_id"] == str(self.p1.pk) for record in records))

    def test_an_unknown_period_in_the_body_is_a_404(self) -> None:
        """Was a 400 from the related field; now resolved like the register's query."""
        body = self.payload(self.p1)
        body["period_id"] = "0f3b4a1e-0000-4000-8000-000000000000"

        response = self.client.post(BULK_MARK, body, format="json")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_named_session_that_does_not_contain_the_date_is_refused(self) -> None:
        """The marker check and the gate read one session; a period register needs the date's."""
        with tenant_context(self.tenant.id):
            last_year = AcademicSessionFactory(tenant=self.tenant, **LAST_SESSION_WINDOW)
        body = {**self.payload(self.p1), "academic_session_id": str(last_year.pk)}

        response = self.client.post(BULK_MARK, body, format="json")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("academic_session_id", self.field_errors(response))
        entries = [{"student_id": self.students[0].pk, "status": AttendanceStatus.PRESENT}]
        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation) as raised:
            services.bulk_mark_student_attendance(
                section=self.section,
                session=last_year,
                on_date=MARKING_DATE,
                period=self.p1,
                entries=entries,
                actor_id=self.user.pk,
            )
        self.assertIn("academic_session_id", str(raised.exception.detail))


class DailySessionTests(ModeTestCase):
    """Daily mode checks the session contains the date too, else rows land in the wrong one."""

    def setUp(self) -> None:
        super().setUp()
        self.sign_in(self.user, MARK, scope=RecordScope.ALL)
        with tenant_context(self.tenant.id):
            self.last_year = AcademicSessionFactory(tenant=self.tenant, **LAST_SESSION_WINDOW)

    def test_a_named_session_that_does_not_contain_the_date_is_refused(self) -> None:
        body = {**self.payload(), "academic_session_id": str(self.last_year.pk)}

        response = self.client.post(BULK_MARK, body, format="json")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("academic_session_id", self.field_errors(response))
        with tenant_context(self.tenant.id):
            self.assertFalse(StudentAttendance.objects.alive().exists())

    def test_the_service_refuses_it_without_the_view(self) -> None:
        entries = [{"student_id": self.students[0].pk, "status": AttendanceStatus.PRESENT}]
        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation) as raised:
            services.bulk_mark_student_attendance(
                section=self.section,
                session=self.last_year,
                on_date=MARKING_DATE,
                period=None,
                entries=entries,
                actor_id=self.user.pk,
            )
        self.assertIn("academic_session_id", str(raised.exception.detail))

    def test_a_named_session_that_contains_the_date_is_marked(self) -> None:
        body = {**self.payload(), "academic_session_id": str(self.session.pk)}

        response = self.client.post(BULK_MARK, body, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        sessions = {row["academic_session_id"] for row in response.json()["data"]}
        self.assertEqual(sessions, {str(self.session.pk)})

    def test_a_register_read_outside_every_session_is_refused(self) -> None:
        """No session contains the date, so the fallback (the current one) is refused."""
        first_start = min(self.session.start_date, self.last_year.start_date)
        before = first_start - datetime.timedelta(days=1)
        url = f"{REGISTER}?section_id={self.section.pk}&date={before.isoformat()}"

        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("academic_session_id", self.field_errors(response))


class TimetableOffTests(PeriodModeTestCase):
    """A period register needs `module.timetable` on, as switching to period mode does."""

    def setUp(self) -> None:
        super().setUp()
        self.sign_in(self.user, MARK, scope=RecordScope.ALL)
        disable_feature(self.tenant, services.TIMETABLE_FEATURE)

    def assert_timetable_required(self, response) -> None:
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn(
            {"field": "period_id", "issue": services.TIMETABLE_REQUIRED},
            response.json()["error"]["details"],
        )

    def test_the_register_read_is_refused(self) -> None:
        self.assert_timetable_required(self.client.get(self.register_url(self.p1)))

    def test_bulk_mark_is_refused_and_writes_nothing(self) -> None:
        self.assert_timetable_required(self.bulk(self.p1))
        with tenant_context(self.tenant.id):
            self.assertFalse(StudentAttendance.objects.alive().exists())

    def test_daily_mode_needs_no_timetable(self) -> None:
        configure_academic(self.tenant, attendance_mode="daily")

        self.assertEqual(self.bulk().status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.get(self.register_url()).status_code, status.HTTP_200_OK)


class TimetableReadOnceTests(PeriodModeTestCase):
    """The marker check and the gate share one read of the timetable per request."""

    def setUp(self) -> None:
        super().setUp()
        self.sign_in(self.slot_user, MARK)

    def test_marking_reads_the_effective_timetable_once(self) -> None:
        with mock.patch.object(
            services, "effective_slots_for", wraps=services.effective_slots_for
        ) as reads:
            response = self.bulk(self.p1)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(reads.call_count, 1)

    def test_the_register_reads_the_effective_timetable_once(self) -> None:
        with mock.patch.object(
            services, "effective_slots_for", wraps=services.effective_slots_for
        ) as reads:
            response = self.client.get(self.register_url(self.p1))

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(reads.call_count, 1)


# ---------------------------------------------------------------------------
# Who marks a period register
# ---------------------------------------------------------------------------


class PeriodMarkerTests(PeriodModeTestCase):
    def test_the_slot_teacher_marks_their_lesson(self) -> None:
        self.sign_in(self.slot_user, MARK)

        self.assertEqual(self.bulk(self.p1).status_code, status.HTTP_200_OK)
        self.assertEqual(
            self.client.get(self.register_url(self.p1)).status_code, status.HTTP_200_OK
        )

    def test_the_class_teacher_marks_a_lesson_they_do_not_teach(self) -> None:
        self.sign_in(self.teacher_user, MARK)

        self.assertEqual(self.bulk(self.p2).status_code, status.HTTP_200_OK)

    def test_an_all_scoped_marker_marks_any_lesson(self) -> None:
        self.sign_in(self.user, MARK, scope=RecordScope.ALL)

        self.assertEqual(self.bulk(self.p3).status_code, status.HTTP_200_OK)

    def test_a_campus_marker_marks_their_campus_only(self) -> None:
        user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            elsewhere = CampusFactory(tenant=self.tenant)
        self.sign_in(user, MARK, scope=RecordScope.CAMPUS, scope_ref=elsewhere.pk)
        self.assertEqual(self.bulk(self.p1).status_code, status.HTTP_404_NOT_FOUND)

        grant(user, MARK, scope=RecordScope.CAMPUS, scope_ref=self.campus.pk)
        self.assertEqual(self.bulk(self.p1).status_code, status.HTTP_200_OK)

    def test_a_confirmed_substitute_replaces_the_absent_teacher(self) -> None:
        substitute_user, substitute = self.staff_user()
        self.cover(self.p1, substitute)

        self.sign_in(substitute_user, MARK)
        self.assertEqual(self.bulk(self.p1).status_code, status.HTTP_200_OK)

        self.sign_in(self.slot_user, MARK)
        refused = self.bulk(self.p1)
        self.assertEqual(refused.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("section_id", self.field_errors(refused))
        self.assertEqual(
            self.client.get(self.register_url(self.p1)).status_code, status.HTTP_404_NOT_FOUND
        )
        # Their uncovered lessons stay theirs.
        self.assertEqual(self.bulk(self.p2).status_code, status.HTTP_200_OK)

    def test_a_proposed_substitution_hands_nothing_over(self) -> None:
        substitute_user, substitute = self.staff_user()
        self.cover(self.p1, substitute, status_value=SubstitutionStatus.PROPOSED)

        self.sign_in(substitute_user, MARK)
        self.assertEqual(self.bulk(self.p1).status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.sign_in(self.slot_user, MARK)
        self.assertEqual(self.bulk(self.p1).status_code, status.HTTP_200_OK)

    def test_a_stranger_is_refused(self) -> None:
        stranger, _ = self.staff_user()
        self.sign_in(stranger, MARK)

        refused = self.bulk(self.p1)

        self.assertEqual(refused.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("section_id", self.field_errors(refused))
        self.assertEqual(
            self.client.get(self.register_url(self.p1)).status_code, status.HTTP_404_NOT_FOUND
        )

    def test_own_scope_alone_marks_no_lesson(self) -> None:
        self.sign_in(self.slot_user, MARK, scope=RecordScope.OWN)

        self.assertEqual(self.bulk(self.p1).status_code, status.HTTP_404_NOT_FOUND)

    def test_a_past_date_reads_the_version_in_force_that_day(self) -> None:
        """Review Focus 2: republished yesterday, the day before still names the old teacher."""
        old_user, old_teacher = self.staff_user()
        new_user, new_teacher = self.staff_user()
        for user in (old_user, new_user):
            grant(user, MARK, scope=RecordScope.ASSIGNED)
        yesterday = MARKING_DATE - datetime.timedelta(days=1)
        day_before = MARKING_DATE - datetime.timedelta(days=2)
        # The same weekday as the day before, a week on: the new version's first such day.
        week_on = day_before + datetime.timedelta(days=7)
        self.publish(self.p4, old_teacher, on_date=day_before, effective_to=yesterday)
        self.publish(self.p4, new_teacher, on_date=day_before, effective_from=yesterday)

        def may_mark(user, on_date) -> bool:
            with tenant_context(self.tenant.id):
                return register.may_mark_register(
                    user=user, section=self.section, on_date=on_date, period=self.p4
                )

        self.assertTrue(may_mark(old_user, day_before))
        self.assertFalse(may_mark(new_user, day_before))
        self.assertTrue(may_mark(new_user, week_on))
        self.assertFalse(may_mark(old_user, week_on))


class PeriodMyRegistersTests(PeriodModeTestCase):
    def registers(self) -> list[dict]:
        response = self.client.get(f"{MY_REGISTERS}?date={MARKING_DATE.isoformat()}")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return response.json()["data"]

    def test_the_slot_teacher_gets_one_entry_per_lesson_in_start_order(self) -> None:
        self.sign_in(self.slot_user, MARK)

        rows = self.registers()

        self.assertEqual(
            [row["period_id"] for row in rows], [str(p.pk) for p in (self.p1, self.p2, self.p3)]
        )
        self.assertEqual({row["section_id"] for row in rows}, {str(self.section.pk)})
        self.assertEqual(rows[0]["period_name"], self.p1.name)
        self.assertEqual(rows[0]["roster_count"], len(self.students))

    def test_the_class_teacher_gets_every_lesson_of_their_section(self) -> None:
        self.sign_in(self.teacher_user, MARK)

        self.assertEqual(len(self.registers()), 3)

    def test_cover_moves_the_entry_to_the_substitute(self) -> None:
        substitute_user, substitute = self.staff_user()
        self.cover(self.p1, substitute)

        self.sign_in(self.slot_user, MARK)
        self.assertNotIn(str(self.p1.pk), [row["period_id"] for row in self.registers()])
        self.sign_in(substitute_user, MARK)
        self.assertEqual([row["period_id"] for row in self.registers()], [str(self.p1.pk)])

    def test_marked_count_is_per_period(self) -> None:
        self.mark(self.p2, [{"student_id": self.students[0].pk, "status": "present"}])
        self.sign_in(self.slot_user, MARK)

        counts = {row["period_id"]: row["marked_count"] for row in self.registers()}

        self.assertEqual(counts[str(self.p2.pk)], 1)
        self.assertEqual(counts[str(self.p1.pk)], 0)

    def test_the_query_count_does_not_grow_with_lessons_or_sections(self) -> None:
        self.sign_in(self.slot_user, MARK)
        self.registers()  # Warm the per-user permission, scope and feature caches.
        with CaptureQueriesContext(connection) as before:
            self.registers()
        with tenant_context(self.tenant.id):
            second = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=self.campus
            )
        self.publish(self.p4, self.slot_teacher, section=second)

        with CaptureQueriesContext(connection) as after:
            rows = self.registers()

        self.assertEqual(len(rows), 4)
        self.assertEqual(len(after.captured_queries), len(before.captured_queries))


# ---------------------------------------------------------------------------
# Leave, lateness and alerts in period mode
# ---------------------------------------------------------------------------


class PeriodLeaveTests(PeriodModeTestCase):
    def test_an_on_leave_student_is_refused_in_a_period_register_and_alerts_no_one(self) -> None:
        """Review Focus 3: the server, not the screen, keeps the absence alert from going."""
        on_leave = self.students[0]
        with tenant_context(self.tenant.id):
            StudentAttendanceFactory(
                tenant=self.tenant,
                student=on_leave,
                section=self.section,
                academic_session=self.session,
                attendance_date=MARKING_DATE,
                status=AttendanceStatus.ON_LEAVE,
                marked_by=self.user.pk,
            )
        self.sign_in(self.slot_user, MARK)

        with mock.patch.object(services, "_queue_alerts") as alerts:
            response = self.bulk(self.p1, status_value=AttendanceStatus.ABSENT)

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        rows = response.json()["error"]["meta"]["rows"]
        self.assertEqual([row["student_id"] for row in rows], [str(on_leave.pk)])
        self.assertEqual(rows[0]["issue"], services.ON_APPROVED_LEAVE)
        alerts.assert_not_called()
        with tenant_context(self.tenant.id):
            self.assertFalse(StudentAttendance.objects.alive().filter(period=self.p1).exists())


class PeriodLatenessTests(PeriodModeTestCase):
    def late(self, period, check_in: datetime.time) -> StudentAttendance:
        entry = {
            "student_id": self.students[0].pk,
            "status": AttendanceStatus.LATE,
            "check_in_time": check_in,
        }
        self.mark(period, [entry])
        with tenant_context(self.tenant.id):
            return StudentAttendance.objects.alive().get(student=self.students[0], period=period)

    def test_lateness_runs_from_the_periods_start_not_the_days(self) -> None:
        # P3 starts 09:00; from the 08:00 day start this would be 80.
        self.assertEqual(self.late(self.p3, datetime.time(9, 20)).late_minutes, 20)

    def test_the_grace_minutes_apply_to_a_period(self) -> None:
        self.assertEqual(self.late(self.p2, datetime.time(8, 9)).late_minutes, 0)

    def test_an_approved_correction_recomputes_from_the_period_start(self) -> None:
        approver = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            row = StudentAttendanceFactory(
                tenant=self.tenant,
                student=self.students[0],
                section=self.section,
                academic_session=self.session,
                period=self.p3,
                attendance_date=MARKING_DATE,
                status=AttendanceStatus.ABSENT,
                is_locked=True,
                marked_by=self.user.pk,
            )
            correction = services.request_correction(
                target=row,
                new_values={"status": AttendanceStatus.LATE, "check_in_time": datetime.time(9, 30)},
                reason="Arrived from the nurse's office.",
                actor_id=self.user.pk,
            )
            services.decide_correction(correction=correction, approve=True, reviewer_id=approver.pk)
            row.refresh_from_db()

        self.assertEqual(row.late_minutes, 30)


class PeriodAlertTests(PeriodModeTestCase):
    def mark_one(self, period, status_value, **extra) -> list[StudentAttendance]:
        entry = {"student_id": self.students[0].pk, "status": status_value, **extra}
        return self.mark(period, [entry])["alerts"]

    def test_absent_in_two_periods_is_one_absence_alert(self) -> None:
        self.assertEqual(len(self.mark_one(self.p1, AttendanceStatus.ABSENT)), 1)
        self.assertEqual(self.mark_one(self.p2, AttendanceStatus.ABSENT), [])

    def test_present_then_absent_alerts_once(self) -> None:
        self.assertEqual(self.mark_one(self.p1, AttendanceStatus.PRESENT), [])
        self.assertEqual(len(self.mark_one(self.p3, AttendanceStatus.ABSENT)), 1)

    def test_late_then_absent_is_one_late_and_one_absence_alert(self) -> None:
        late = self.mark_one(self.p1, AttendanceStatus.LATE, check_in_time=datetime.time(7, 30))
        absent = self.mark_one(self.p3, AttendanceStatus.ABSENT)

        self.assertEqual([row.status for row in late], [AttendanceStatus.LATE])
        self.assertEqual([row.status for row in absent], [AttendanceStatus.ABSENT])

    def test_a_resubmission_alerts_no_one(self) -> None:
        self.mark_one(self.p1, AttendanceStatus.ABSENT)

        self.assertEqual(self.mark_one(self.p1, AttendanceStatus.ABSENT), [])

    def test_a_daily_absence_before_the_switch_counts(self) -> None:
        with tenant_context(self.tenant.id):
            StudentAttendanceFactory(
                tenant=self.tenant,
                student=self.students[0],
                section=self.section,
                academic_session=self.session,
                attendance_date=MARKING_DATE,
                status=AttendanceStatus.ABSENT,
                marked_by=self.user.pk,
            )

        self.assertEqual(self.mark_one(self.p1, AttendanceStatus.ABSENT), [])


# ---------------------------------------------------------------------------
# Reports: derived days
# ---------------------------------------------------------------------------


class DerivedDaysTestCase(PeriodModeTestCase):
    def row(self, student, on_date, status_value, period=None, **extra) -> None:
        with tenant_context(self.tenant.id):
            StudentAttendanceFactory(
                tenant=self.tenant,
                student=student,
                section=self.section,
                academic_session=self.session,
                attendance_date=on_date,
                period=period,
                status=status_value,
                marked_by=self.user.pk,
                **extra,
            )

    def periods_of(self, student, on_date, *statuses, lates=()) -> None:
        late_by_index = dict(lates)
        for index, (period, value) in enumerate(zip(self.periods, statuses, strict=False)):
            self.row(student, on_date, value, period, late_minutes=late_by_index.get(index))

    def days(self) -> dict:
        with tenant_context(self.tenant.id):
            rows = reports.derived_days(
                StudentAttendance.objects.alive(),
                start_date=MARKING_DATE - datetime.timedelta(days=30),
                end_date=MARKING_DATE,
            )
        return {(row["student_id"], row["attendance_date"]): row for row in rows}


class DerivedDayRuleTests(DerivedDaysTestCase):
    def derived(self, *statuses, lates=(), daily=None) -> dict:
        student = self.students[0]
        if daily is not None:
            self.row(student, MARKING_DATE, daily)
        self.periods_of(student, MARKING_DATE, *statuses, lates=lates)
        return self.days()[(student.pk, MARKING_DATE)]

    def test_every_period_absent_is_absent(self) -> None:
        self.assertEqual(self.derived("absent", "absent")["status"], "absent")

    def test_any_period_absent_is_a_half_day(self) -> None:
        self.assertEqual(self.derived("present", "absent", "present")["status"], "half_day")

    def test_the_earliest_period_late_is_late_with_its_minutes(self) -> None:
        day = self.derived("late", "present", lates=[(0, 7)])

        self.assertEqual((day["status"], day["late_minutes"]), ("late", 7))

    def test_a_later_period_late_is_present(self) -> None:
        self.assertEqual(self.derived("present", "late", lates=[(1, 5)])["status"], "present")

    def test_every_period_excused_is_excused(self) -> None:
        self.assertEqual(self.derived("excused", "excused")["status"], "excused")

    def test_excused_and_present_is_present(self) -> None:
        self.assertEqual(self.derived("excused", "present")["status"], "present")

    def test_a_daily_row_wins_over_period_rows(self) -> None:
        self.assertEqual(self.derived("absent", "absent", daily="present")["status"], "present")

    def test_an_imported_daily_row_is_a_day(self) -> None:
        self.row(self.students[1], MARKING_DATE, "absent", source=AttendanceSource.IMPORT)

        self.assertEqual(self.days()[(self.students[1].pk, MARKING_DATE)]["status"], "absent")

    def test_one_query_whatever_the_number_of_periods(self) -> None:
        for student in self.students:
            self.periods_of(student, MARKING_DATE, "present", "absent", "late", "present")
        with tenant_context(self.tenant.id), self.assertNumQueries(1):
            reports.derived_days(
                StudentAttendance.objects.alive(), start_date=MARKING_DATE, end_date=MARKING_DATE
            )


class AcrossTheSwitchTests(DerivedDaysTestCase):
    """Review Focus 4: daily history then period rows, counted in days throughout."""

    def setUp(self) -> None:
        super().setUp()
        self.grant_reports()
        student = self.students[0]
        self.start = MARKING_DATE - datetime.timedelta(days=3)
        # Two daily days before the switch (one imported), then two period days.
        self.row(student, self.start, "present")
        self.row(
            student,
            self.start + datetime.timedelta(days=1),
            "present",
            source=AttendanceSource.IMPORT,
        )
        self.periods_of(student, self.start + datetime.timedelta(days=2), "absent", "absent")
        self.periods_of(student, MARKING_DATE, "late", "present", lates=[(0, 12)])

    def grant_reports(self) -> None:
        self.sign_in(
            self.user, "attendance.report.view", "attendance.report.export", scope=RecordScope.ALL
        )

    def report(self, kind: str, **params) -> list[dict]:
        query = "&".join(f"{key}={value}" for key, value in params.items())
        response = self.client.get(f"{REPORTS}?kind={kind}&{query}")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["meta"]["attendance_mode"], "period")
        return response.json()["data"]

    def span(self) -> dict:
        return {"start_date": self.start.isoformat(), "end_date": MARKING_DATE.isoformat()}

    def test_the_summary_counts_both_halves_in_days(self) -> None:
        (row,) = self.report("student-summary", **self.span())

        self.assertEqual(row["counted_days"], 4)
        self.assertEqual(row["present_days"], 3)
        self.assertEqual(row["absent_days"], 1)
        self.assertEqual(row["late_days"], 1)
        self.assertEqual(Decimal(str(row["attendance_rate"])), Decimal("75.0"))

    def test_defaulters_read_the_same_days(self) -> None:
        with tenant_context(self.tenant.id):
            rows = reports.defaulters(
                StudentAttendance.objects.alive(),
                start_date=self.start,
                end_date=MARKING_DATE,
                threshold=Decimal("80.0"),
            )

        self.assertEqual([row["student_id"] for row in rows], [self.students[0].pk])

    def test_late_arrivals_count_the_late_day_once(self) -> None:
        (row,) = self.report("student-late-arrivals", **self.span())

        self.assertEqual((row["late_count"], row["total_late_minutes"]), (1, 12))

    def test_a_limited_summary_still_counts_days_in_one_query(self) -> None:
        with tenant_context(self.tenant.id), self.assertNumQueries(1):
            (row,) = reports.student_summary(
                StudentAttendance.objects.alive(),
                start_date=self.start,
                end_date=MARKING_DATE,
                limit=1,
            )

        self.assertEqual(row["counted_days"], 4)

    def test_a_defaulter_limit_bounds_the_rows_in_one_query(self) -> None:
        """The threshold and the cap are applied in SQL, so `limit` bounds the work too."""
        self.row(self.students[1], self.start, "absent")

        def defaulters(limit=None) -> list[dict]:
            return reports.defaulters(
                StudentAttendance.objects.alive(),
                start_date=self.start,
                end_date=MARKING_DATE,
                threshold=Decimal("80.0"),
                limit=limit,
            )

        with tenant_context(self.tenant.id):
            self.assertEqual(len(defaulters()), 2)
            with self.assertNumQueries(1):
                self.assertEqual(len(defaulters(limit=1)), 1)

    def test_late_arrivals_are_one_query(self) -> None:
        with tenant_context(self.tenant.id), self.assertNumQueries(1):
            rows = reports.student_late_arrivals(
                StudentAttendance.objects.alive(), start_date=self.start, end_date=MARKING_DATE
            )

        self.assertEqual(len(rows), 1)

    def test_the_daily_register_shows_the_derived_day(self) -> None:
        (row,) = self.report("daily-register", start_date=MARKING_DATE.isoformat())

        self.assertEqual((row["status"], row["late_minutes"]), ("late", 12))
        self.assertIsNone(row["id"])
        self.assertIsNone(row["period_name"])

    def test_the_daily_register_shows_a_daily_row_as_marked(self) -> None:
        (row,) = self.report("daily-register", start_date=self.start.isoformat())

        self.assertEqual(row["status"], "present")
        self.assertIsNotNone(row["id"])

    def test_the_daily_register_lists_one_periods_rows_with_its_name(self) -> None:
        rows = self.report(
            "daily-register", start_date=MARKING_DATE.isoformat(), period_id=self.p1.pk
        )

        self.assertEqual([row["status"] for row in rows], ["late"])
        self.assertEqual(rows[0]["period_name"], self.p1.name)


class EmptyScopeTests(ModeTestCase):
    """A queryset that can match nothing compiles to no SQL; every derived report is empty."""

    def test_each_derived_report_over_nothing_is_empty_without_a_query(self) -> None:
        start = MARKING_DATE - datetime.timedelta(days=7)
        nothing = StudentAttendance.objects.none()
        ranged = (
            reports.student_summary,
            reports.defaulters,
            reports.student_late_arrivals,
            reports.derived_days,
        )
        with tenant_context(self.tenant.id), self.assertNumQueries(0):
            for report in ranged:
                with self.subTest(report=report.__name__):
                    self.assertEqual(report(nothing, start_date=start, end_date=MARKING_DATE), [])
            self.assertEqual(reports.daily_register(nothing, on_date=MARKING_DATE), [])

    def test_a_reader_whose_scope_resolves_to_nothing_gets_empty_reports(self) -> None:
        """`scope_queryset` fails closed with `.none()`: a campus role with no campus."""
        reader = UserFactory(tenant=self.tenant)
        self.sign_in(reader, "attendance.report.view", scope=RecordScope.CAMPUS, scope_ref=None)

        for kind in ("student-summary", "defaulters", "student-late-arrivals", "daily-register"):
            with self.subTest(kind=kind):
                response = self.client.get(
                    f"{REPORTS}?kind={kind}&start_date={MARKING_DATE.isoformat()}"
                )

                self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
                self.assertEqual(response.json()["data"], [])


class SettingsCrossTenantTests(ModeTestCase):
    """Settings are one row per tenant: another tenant's are never read or written."""

    def test_settings_read_and_write_only_the_callers_tenant(self) -> None:
        other = TenantFactory()
        configure_academic(other, attendance_mode="period", attendance_lock_window_days=5)
        self.sign_in(self.user, SETTINGS_VIEW, SETTINGS_UPDATE, scope=RecordScope.ALL)

        ours = self.client.get(SETTINGS).json()["data"]
        self.assertEqual((ours["attendance_mode"], ours["lock_window_days"]), ("daily", 0))
        self.client.patch(SETTINGS, {"lock_window_days": 2}, format="json")

        with tenant_context(other.id):
            theirs = TenantSettings.objects.get(tenant=other).academic
        self.assertEqual(theirs["attendance_lock_window_days"], 5)
        self.assertEqual(theirs["attendance_mode"], "period")
