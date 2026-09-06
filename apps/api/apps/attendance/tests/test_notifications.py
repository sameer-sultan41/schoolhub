"""§12's guardian alerts, and the nightly lock sweep.

The alert test is the one that matters most in this module: §2 measures
attendance by whether a guardian hears about an unexplained absence the same
morning, so "who receives it" is a safeguarding question, not a preference.
"""

from __future__ import annotations

import datetime
from unittest import mock

from django.test import TestCase
from django.utils import timezone

from apps.attendance import notifications, tasks
from apps.attendance.models import AttendanceStatus, StudentAttendance
from apps.attendance.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    GuardianFactory,
    SectionFactory,
    StudentAttendanceFactory,
    StudentFactory,
    StudentGuardianFactory,
    TenantFactory,
    UserFactory,
    open_all_week,
)
from core.notifications.models import Notification
from core.tenancy.context import tenant_context


class AlertFanOutTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        open_all_week(self.tenant)
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.session = AcademicSessionFactory(tenant=self.tenant, is_current=True)
            self.school_class = ClassFactory(tenant=self.tenant, level=6)
            self.section = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=self.campus
            )
            self.student = StudentFactory(tenant=self.tenant, campus=self.campus)

        self.guardian_user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            self.guardian = GuardianFactory(tenant=self.tenant, user_id=self.guardian_user.pk)
            self.link = StudentGuardianFactory(
                tenant=self.tenant,
                student=self.student,
                guardian=self.guardian,
                has_portal_access=True,
            )

    def mark(self, status_value) -> StudentAttendance:
        with tenant_context(self.tenant.id):
            return StudentAttendanceFactory(
                tenant=self.tenant,
                student=self.student,
                section=self.section,
                academic_session=self.session,
                status=status_value,
                marked_by=self.user.pk,
            )

    def run_task(self, row) -> dict:
        return tasks.send_attendance_alerts(
            tenant_id=str(self.tenant.id), attendance_ids=[str(row.pk)]
        )

    def test_an_absence_reaches_the_students_portal_guardian(self) -> None:
        row = self.mark(AttendanceStatus.ABSENT)

        result = self.run_task(row)

        self.assertEqual(result["notified"], 1)
        with tenant_context(self.tenant.id):
            notification = Notification.objects.get(user_id=self.guardian_user.pk)
            self.assertEqual(notification.event_key, notifications.ABSENCE_ALERT)

    def test_a_late_arrival_uses_its_own_trigger(self) -> None:
        row = self.mark(AttendanceStatus.LATE)

        self.run_task(row)

        with tenant_context(self.tenant.id):
            self.assertEqual(
                Notification.objects.get(user_id=self.guardian_user.pk).event_key,
                notifications.LATE_ALERT,
            )

    def test_a_present_student_generates_no_alert(self) -> None:
        row = self.mark(AttendanceStatus.PRESENT)

        result = self.run_task(row)

        self.assertEqual(result["notified"], 0)

    def test_a_guardian_whose_portal_access_was_revoked_is_not_told(self) -> None:
        """The same gate `Student.filter_owned_by_user` uses for read access.
        Revoking a guardian's access and then continuing to email them their
        child's attendance would defeat the point of revoking it."""
        with tenant_context(self.tenant.id):
            self.link.has_portal_access = False
            self.link.save(update_fields=["has_portal_access", "updated_at"])
        row = self.mark(AttendanceStatus.ABSENT)

        result = self.run_task(row)

        self.assertEqual(result["notified"], 0)

    def test_a_guardian_with_no_portal_account_is_skipped_not_errored(self) -> None:
        """An ordinary state: §12 names no fallback recipient, and a student with
        no reachable guardian must not fail the whole register's fan-out."""
        with tenant_context(self.tenant.id):
            self.guardian.user_id = None
            self.guardian.save(update_fields=["user_id", "updated_at"])
        row = self.mark(AttendanceStatus.ABSENT)

        result = self.run_task(row)

        self.assertEqual(result["notified"], 0)

    def test_one_students_failure_does_not_cost_the_rest_of_the_class_theirs(self) -> None:
        """The register is committed either way, so a template or transport
        problem on one row must not swallow the others."""
        second_student_user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            other_student = StudentFactory(tenant=self.tenant, campus=self.campus)
            other_guardian = GuardianFactory(tenant=self.tenant, user_id=second_student_user.pk)
            StudentGuardianFactory(
                tenant=self.tenant,
                student=other_student,
                guardian=other_guardian,
                has_portal_access=True,
            )
            first = StudentAttendanceFactory(
                tenant=self.tenant,
                student=self.student,
                section=self.section,
                academic_session=self.session,
                status=AttendanceStatus.ABSENT,
                marked_by=self.user.pk,
            )
            second = StudentAttendanceFactory(
                tenant=self.tenant,
                student=other_student,
                section=self.section,
                academic_session=self.session,
                status=AttendanceStatus.ABSENT,
                marked_by=self.user.pk,
            )

        calls = {"n": 0}

        def flaky(*args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("template blew up")
            return []

        with mock.patch("core.notifications.services.notify", side_effect=flaky):
            result = tasks.send_attendance_alerts(
                tenant_id=str(self.tenant.id),
                attendance_ids=[str(first.pk), str(second.pk)],
            )

        self.assertEqual(calls["n"], 2)
        self.assertEqual(result["notified"], 1)


class LockSweepTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        open_all_week(self.tenant)
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.session = AcademicSessionFactory(tenant=self.tenant, is_current=True)
            self.school_class = ClassFactory(tenant=self.tenant, level=6)
            self.section = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=self.campus
            )

    def row_on(self, day: datetime.date) -> StudentAttendance:
        with tenant_context(self.tenant.id):
            return StudentAttendanceFactory(
                tenant=self.tenant,
                student=StudentFactory(tenant=self.tenant, campus=self.campus),
                section=self.section,
                academic_session=self.session,
                attendance_date=day,
                marked_by=self.user.pk,
            )

    def test_yesterdays_rows_are_locked_and_todays_are_not(self) -> None:
        yesterday = self.row_on(timezone.localdate() - datetime.timedelta(days=1))
        today = self.row_on(timezone.localdate())

        tasks.lock_expired_attendance()

        yesterday.refresh_from_db()
        today.refresh_from_db()
        self.assertTrue(yesterday.is_locked)
        self.assertFalse(today.is_locked)

    def test_the_sweep_does_not_reach_another_tenants_rows(self) -> None:
        """`for_each_tenant` binds each tenant in turn. An unbound cross-tenant
        UPDATE does not raise under RLS — it silently matches zero rows — which
        is why the sweep shape is what makes this work at all."""
        other = TenantFactory()
        other_user = UserFactory(tenant=other)
        with tenant_context(other.id):
            other_campus = CampusFactory(tenant=other)
            other_session = AcademicSessionFactory(tenant=other, is_current=True)
            other_class = ClassFactory(tenant=other, level=6)
            other_section = SectionFactory(
                tenant=other, school_class=other_class, campus=other_campus
            )
            foreign = StudentAttendanceFactory(
                tenant=other,
                student=StudentFactory(tenant=other, campus=other_campus),
                section=other_section,
                academic_session=other_session,
                attendance_date=timezone.localdate() - datetime.timedelta(days=1),
                marked_by=other_user.pk,
            )

        result = tasks.lock_expired_attendance()

        # Both tenants are swept, so the foreign row *is* locked — by its own
        # tenant's pass, not by ours. The assertion that matters is that the
        # sweep visited more than one tenant rather than issuing one wide UPDATE.
        self.assertGreaterEqual(result["tenants"], 2)
        with tenant_context(other.id):
            foreign.refresh_from_db()
            self.assertTrue(foreign.is_locked)

    def test_a_tenants_configured_window_is_honoured(self) -> None:
        from apps.attendance.tests.factories import configure_academic

        configure_academic(self.tenant, attendance_lock_window_days=7)
        recent = self.row_on(timezone.localdate() - datetime.timedelta(days=3))

        tasks.lock_expired_attendance()

        recent.refresh_from_db()
        self.assertFalse(recent.is_locked)
