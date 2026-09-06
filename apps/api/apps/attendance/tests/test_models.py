"""The database-level rules `student_attendance` and `attendance_corrections` carry.

These assert through `IntegrityError` rather than through the service, on purpose:
the service checks the same things, but §6 requires marking to survive a genuine
concurrent re-submission, and only the index decides that. A test that went
through the service would still pass if both constraints were dropped.
"""

from __future__ import annotations

import datetime

from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from apps.attendance.models import AttendanceStatus, StudentAttendance
from apps.attendance.tests.factories import (
    MARKING_DATE,
    AcademicSessionFactory,
    AttendanceCorrectionFactory,
    CampusFactory,
    ClassFactory,
    PeriodFactory,
    SectionFactory,
    StudentAttendanceFactory,
    StudentFactory,
    TenantFactory,
    UserFactory,
)
from core.tenancy.context import tenant_context


class StudentAttendanceConstraintTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.session = AcademicSessionFactory(tenant=self.tenant, is_current=True)
            self.school_class = ClassFactory(tenant=self.tenant, level=6)
            self.section = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=self.campus
            )
            self.student = StudentFactory(tenant=self.tenant, campus=self.campus)
            self.period = PeriodFactory(tenant=self.tenant, sequence=1)

    def mark(self, **overrides) -> StudentAttendance:
        defaults = {
            "tenant": self.tenant,
            "student": self.student,
            "section": self.section,
            "academic_session": self.session,
            "marked_by": self.user.pk,
        }
        return StudentAttendanceFactory(**{**defaults, **overrides})

    def test_a_student_cannot_be_marked_twice_on_the_same_day(self) -> None:
        with tenant_context(self.tenant.id):
            self.mark()
            with self.assertRaises(IntegrityError), transaction.atomic():
                self.mark(status=AttendanceStatus.ABSENT)

    def test_a_student_cannot_be_marked_twice_in_the_same_period(self) -> None:
        with tenant_context(self.tenant.id):
            self.mark(period=self.period)
            with self.assertRaises(IntegrityError), transaction.atomic():
                self.mark(period=self.period, status=AttendanceStatus.ABSENT)

    def test_a_daily_row_and_a_period_row_coexist_for_the_same_day(self) -> None:
        """The case a single unique index over all four columns gets wrong.

        PostgreSQL treats NULLs as distinct, so one index could not enforce the
        daily rule at all; two disjoint partial indexes enforce both, and let a
        tenant that turns period mode on mid-session keep its daily history
        rather than choosing one shape for the whole year.
        """
        with tenant_context(self.tenant.id):
            self.mark()
            self.mark(period=self.period)

            self.assertEqual(StudentAttendance.objects.count(), 2)

    def test_two_different_periods_on_one_day_are_both_allowed(self) -> None:
        with tenant_context(self.tenant.id):
            second = PeriodFactory(tenant=self.tenant, sequence=2)
            self.mark(period=self.period)
            self.mark(period=second)

            self.assertEqual(StudentAttendance.objects.count(), 2)

    def test_a_soft_deleted_row_does_not_block_remarking_the_same_day(self) -> None:
        """Both indexes are scoped to live rows. Without that, a register
        deleted in error could never be re-entered."""
        with tenant_context(self.tenant.id):
            first = self.mark()
            first.deleted_at = timezone.now()
            first.save(update_fields=["deleted_at", "updated_at"])

            self.mark(status=AttendanceStatus.ABSENT)

            # `objects` is tenant-scoped, not alive-filtered — the deleted row is
            # still there, which is the point: it stays as history and only stops
            # occupying the index.
            self.assertEqual(StudentAttendance.objects.alive().count(), 1)
            self.assertEqual(StudentAttendance.objects.count(), 2)

    def test_another_tenants_row_does_not_collide(self) -> None:
        """The constraints are tenant-first; two schools mark on the same day."""
        other_tenant = TenantFactory()
        other_user = UserFactory(tenant=other_tenant)
        with tenant_context(other_tenant.id):
            other_campus = CampusFactory(tenant=other_tenant)
            other_session = AcademicSessionFactory(tenant=other_tenant, is_current=True)
            other_class = ClassFactory(tenant=other_tenant, level=6)
            other_section = SectionFactory(
                tenant=other_tenant, school_class=other_class, campus=other_campus
            )
            other_student = StudentFactory(tenant=other_tenant, campus=other_campus)
            StudentAttendanceFactory(
                tenant=other_tenant,
                student=other_student,
                section=other_section,
                academic_session=other_session,
                marked_by=other_user.pk,
            )

        with tenant_context(self.tenant.id):
            self.mark()

            self.assertEqual(StudentAttendance.objects.count(), 1)

    def test_negative_late_minutes_are_refused(self) -> None:
        """`late_minutes` is computed, and the computation clamps at zero; a
        negative value can only arrive from something writing the column
        directly, which is what the CHECK is for."""
        with (
            tenant_context(self.tenant.id),
            self.assertRaises(IntegrityError),
            transaction.atomic(),
        ):
            self.mark(status=AttendanceStatus.LATE, late_minutes=-5)

    def test_a_late_row_may_carry_zero_minutes(self) -> None:
        """Arriving inside the grace period is late-but-zero, not an error."""
        with tenant_context(self.tenant.id):
            row = self.mark(
                status=AttendanceStatus.LATE,
                late_minutes=0,
                check_in_time=datetime.time(8, 5),
            )

            self.assertEqual(row.late_minutes, 0)


class AttendanceCorrectionConstraintTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.session = AcademicSessionFactory(tenant=self.tenant, is_current=True)
            self.school_class = ClassFactory(tenant=self.tenant, level=6)
            self.section = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=self.campus
            )
            self.student = StudentFactory(tenant=self.tenant, campus=self.campus)
            self.row = StudentAttendanceFactory(
                tenant=self.tenant,
                student=self.student,
                section=self.section,
                academic_session=self.session,
                attendance_date=MARKING_DATE,
                status=AttendanceStatus.ABSENT,
                marked_by=self.user.pk,
                is_locked=True,
            )

    def test_a_correction_with_no_target_is_refused(self) -> None:
        """It would be approvable and would update nothing."""
        with (
            tenant_context(self.tenant.id),
            self.assertRaises(IntegrityError),
            transaction.atomic(),
        ):
            AttendanceCorrectionFactory(
                tenant=self.tenant, student_attendance=None, requested_by=self.user.pk
            )

    def test_a_correction_pointing_at_a_student_row_is_accepted(self) -> None:
        with tenant_context(self.tenant.id):
            correction = AttendanceCorrectionFactory(
                tenant=self.tenant, student_attendance=self.row, requested_by=self.user.pk
            )

            self.assertEqual(correction.student_attendance_id, self.row.pk)
