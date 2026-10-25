"""The rules `bulk_mark_student_attendance` and the correction flow enforce.

Driven through the service rather than the endpoint: the same functions serve
§9's historical importer and the leave module's auto-marking, so a rule proved
only through HTTP is a rule the other two callers can quietly skip.
"""

from __future__ import annotations

import datetime
from unittest import mock

from django.test import TestCase
from django.utils import timezone

from apps.attendance import services
from apps.attendance.models import (
    AttendanceCorrection,
    AttendanceStatus,
    CorrectionStatus,
    StudentAttendance,
)
from apps.attendance.register import may_mark_register
from apps.attendance.tests.base import SESSION_WINDOW
from apps.attendance.tests.factories import (
    MARKING_DATE,
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    PeriodFactory,
    SectionFactory,
    StaffFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    TenantFactory,
    UserFactory,
    configure_academic,
    enable_feature,
    grant,
    holiday,
    open_all_week,
)
from apps.timetable.models import SlotStatus
from apps.timetable.tests.factories import TimetableSlotFactory
from core.api.exceptions import Conflict, DomainRuleViolation
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context


class MarkingTestCase(TestCase):
    """Structure a register is meaningful inside, without the HTTP layer."""

    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        open_all_week(self.tenant)
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.session = AcademicSessionFactory(
                tenant=self.tenant, is_current=True, **SESSION_WINDOW
            )
            self.school_class = ClassFactory(tenant=self.tenant, level=6)
            self.section = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=self.campus
            )
            self.period = PeriodFactory(tenant=self.tenant, sequence=1)
            self.students = [
                StudentFactory(tenant=self.tenant, campus=self.campus) for _ in range(3)
            ]
            for student in self.students:
                StudentEnrollmentFactory(
                    tenant=self.tenant,
                    student=student,
                    academic_session=self.session,
                    school_class=self.school_class,
                    section=self.section,
                )

    def register(self, *, status=AttendanceStatus.PRESENT, **overrides) -> list[dict]:
        return [{"student_id": s.pk, "status": status, **overrides} for s in self.students]

    def register_plus(self, student, status=AttendanceStatus.PRESENT) -> list[dict]:
        """The section's register with one extra row appended."""
        return [*self.register(), {"student_id": student.pk, "status": status}]

    def mark(self, *, on_date=MARKING_DATE, period=None, entries=None) -> dict:
        return services.bulk_mark_student_attendance(
            section=self.section,
            session=self.session,
            on_date=on_date,
            period=period,
            entries=entries if entries is not None else self.register(),
            actor_id=self.user.pk,
        )


class MarkableDateTests(MarkingTestCase):
    def test_marking_a_non_working_day_is_refused(self) -> None:
        """§11. A school that marks attendance on its weekend has a data problem,
        not a UI annoyance.

        The working week is narrowed here rather than relied on from the default,
        because the fixture opens the school all week so that "today" is always
        markable (factories.MARKING_DATE). Naming the closed day explicitly is
        also what makes this test independent of which weekday CI runs on.
        """
        weekday = MARKING_DATE.weekday()
        open_days = [day for day in range(7) if day != weekday]
        configure_academic(self.tenant, working_days=open_days)

        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation) as raised:
            self.mark()

        self.assertIn("not a working day", str(raised.exception.detail))

    def test_marking_a_holiday_is_refused_and_the_message_names_it(self) -> None:
        """A teacher told only 'this date cannot be marked' retries; one told
        'this is Founders Day' stops. §8's it_admin journey adds a closure
        mid-year and expects attendance to honour it immediately."""
        configure_academic(
            self.tenant, holidays=[holiday(MARKING_DATE.isoformat(), "Founders Day")]
        )

        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation) as raised:
            self.mark()

        self.assertIn("Founders Day", str(raised.exception.detail))

    def test_marking_a_future_date_is_refused(self) -> None:
        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation):
            self.mark(on_date=timezone.localdate() + datetime.timedelta(days=1))

    def test_a_campus_holiday_does_not_close_a_section_on_another_campus(self) -> None:
        with tenant_context(self.tenant.id):
            other_campus = CampusFactory(tenant=self.tenant)
        configure_academic(
            self.tenant,
            holidays=[holiday(MARKING_DATE.isoformat(), "Theirs", campus_id=other_campus.pk)],
        )

        with tenant_context(self.tenant.id):
            result = self.mark()

        self.assertEqual(result["marked"], 3)


class BulkMarkTests(MarkingTestCase):
    def test_a_register_is_marked_once_per_student(self) -> None:
        with tenant_context(self.tenant.id):
            result = self.mark()

            self.assertEqual(result["marked"], 3)
            self.assertEqual(result["updated"], 0)
            self.assertEqual(StudentAttendance.objects.alive().count(), 3)

    def test_resubmitting_the_same_register_updates_rather_than_failing(self) -> None:
        """§6's "offline-tolerant re-submission". A bulk_create would hit
        `student_attendance_one_per_day` on the second attempt and fail the whole
        register — which is exactly what a teacher's phone on school Wi-Fi does."""
        with tenant_context(self.tenant.id):
            self.mark()
            second = self.mark(entries=self.register(status=AttendanceStatus.ABSENT))

            self.assertEqual(second["marked"], 0)
            self.assertEqual(second["updated"], 3)
            self.assertEqual(StudentAttendance.objects.alive().count(), 3)
            self.assertEqual(
                set(StudentAttendance.objects.alive().values_list("status", flat=True)),
                {AttendanceStatus.ABSENT},
            )

    def test_daily_rows_then_a_switch_then_period_rows_overwrite_neither(self) -> None:
        """One mode at a time, but rows written under the other mode stay (ADR-0028)."""
        with tenant_context(self.tenant.id):
            self.mark()
            TimetableSlotFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=self.section,
                period=self.period,
                day_of_week=MARKING_DATE.weekday(),
                status=SlotStatus.PUBLISHED,
            )
        configure_academic(self.tenant, attendance_mode="period")
        enable_feature(self.tenant, "module.timetable")

        with tenant_context(self.tenant.id):
            self.mark(period=self.period, entries=self.register(status=AttendanceStatus.ABSENT))

            rows = StudentAttendance.objects.alive()
            self.assertEqual(rows.count(), 6)
            self.assertEqual(
                set(rows.filter(period__isnull=True).values_list("status", flat=True)),
                {AttendanceStatus.PRESENT},
            )
            self.assertEqual(
                set(rows.filter(period=self.period).values_list("status", flat=True)),
                {AttendanceStatus.ABSENT},
            )

    def test_a_student_not_enrolled_in_the_section_fails_the_row_not_the_teacher(self) -> None:
        """The response carries `error.meta.rows`, the structured-meta path
        core.api.exceptions already provides and test_api_contract.py reserved
        naming this exact case."""
        with tenant_context(self.tenant.id):
            outsider = StudentFactory(tenant=self.tenant, campus=self.campus)
            with self.assertRaises(DomainRuleViolation) as raised:
                self.mark(entries=self.register_plus(outsider))

        rows = raised.exception.meta["rows"]
        self.assertEqual([row["student_id"] for row in rows], [str(outsider.pk)])
        self.assertIn("Not actively enrolled", rows[0]["issue"])

    def test_nothing_commits_when_a_row_is_rejected(self) -> None:
        """A half-applied register is a state no one asked for, and a teacher who
        fixes the bad row and resubmits should not wonder which half took."""
        with tenant_context(self.tenant.id):
            outsider = StudentFactory(tenant=self.tenant, campus=self.campus)
            with self.assertRaises(DomainRuleViolation):
                self.mark(entries=self.register_plus(outsider))

            self.assertEqual(StudentAttendance.objects.alive().count(), 0)

    def test_the_same_student_listed_twice_is_reported(self) -> None:
        duplicated = self.register_plus(self.students[0], AttendanceStatus.ABSENT)

        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation) as raised:
            self.mark(entries=duplicated)

        self.assertIn("more than once", str(raised.exception.meta["rows"]))

    def test_on_leave_cannot_be_marked_at_the_register(self) -> None:
        """It means "there is an approved leave request", and marking it by hand
        would make the `leave_request_id` back-link a lie."""
        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation) as raised:
            self.mark(entries=self.register(status=AttendanceStatus.ON_LEAVE))

        self.assertIn("approved leave request", str(raised.exception.meta["rows"]))

    def test_an_empty_register_is_refused(self) -> None:
        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation):
            self.mark(entries=[])


class LateMinutesTests(MarkingTestCase):
    def test_lateness_is_computed_from_the_tenant_day_window(self) -> None:
        configure_academic(
            self.tenant, day_window={"start": "08:00", "end": "14:00", "grace_minutes": 10}
        )
        with tenant_context(self.tenant.id):
            self.mark(
                entries=[
                    {
                        "student_id": self.students[0].pk,
                        "status": AttendanceStatus.LATE,
                        "check_in_time": datetime.time(8, 25),
                    }
                ]
            )

            row = StudentAttendance.objects.alive().get(student=self.students[0])
            self.assertEqual(row.late_minutes, 25)

    def test_a_client_supplied_late_minutes_is_discarded(self) -> None:
        """§11: "computed server-side, never client-supplied". Validating the
        client's number would still let the caller decide it, and §13's
        punctuality report is only worth reading if every row was measured the
        same way."""
        configure_academic(
            self.tenant, day_window={"start": "08:00", "end": "14:00", "grace_minutes": 10}
        )
        with tenant_context(self.tenant.id):
            self.mark(
                entries=[
                    {
                        "student_id": self.students[0].pk,
                        "status": AttendanceStatus.LATE,
                        "check_in_time": datetime.time(8, 25),
                        "late_minutes": 0,
                    }
                ]
            )

            self.assertEqual(
                StudentAttendance.objects.alive().get(student=self.students[0]).late_minutes, 25
            )

    def test_a_present_student_carries_no_lateness(self) -> None:
        with tenant_context(self.tenant.id):
            self.mark()

            self.assertEqual(
                set(StudentAttendance.objects.alive().values_list("late_minutes", flat=True)),
                {None},
            )


class LockWindowTests(MarkingTestCase):
    def test_a_row_marked_today_is_not_locked(self) -> None:
        with tenant_context(self.tenant.id):
            self.assertFalse(services.is_locked(timezone.localdate()))

    def test_yesterdays_row_is_locked_under_the_default_window(self) -> None:
        """§19's recommended default is end of marking day, i.e. zero days."""
        with tenant_context(self.tenant.id):
            self.assertTrue(services.is_locked(timezone.localdate() - datetime.timedelta(days=1)))

    def test_the_window_is_tenant_configurable(self) -> None:
        configure_academic(self.tenant, attendance_lock_window_days=3)
        with tenant_context(self.tenant.id):
            self.assertFalse(services.is_locked(timezone.localdate() - datetime.timedelta(days=2)))
            self.assertTrue(services.is_locked(timezone.localdate() - datetime.timedelta(days=4)))

    def test_an_out_of_range_window_is_clamped_to_the_documented_maximum(self) -> None:
        """§19 states 0-7. A tenant storing 3650 has turned the correction
        workflow off without anyone deciding to."""
        configure_academic(self.tenant, attendance_lock_window_days=3650)
        with tenant_context(self.tenant.id):
            self.assertEqual(services.lock_window_days(), services.MAX_LOCK_WINDOW_DAYS)

    def test_editing_a_locked_row_through_the_register_is_a_conflict(self) -> None:
        """Not a silent skip: a teacher who believes they fixed yesterday's
        register and did not is worse off than one told to raise a correction."""
        with tenant_context(self.tenant.id):
            self.mark()
            StudentAttendance.objects.alive().update(is_locked=True)

            with self.assertRaises(Conflict):
                self.mark(entries=self.register(status=AttendanceStatus.ABSENT))


class BackfillAlertTests(MarkingTestCase):
    """Guardian alerts go only for dates still inside the lock window (§12)."""

    def mark_absent(self, on_date: datetime.date) -> tuple[dict, mock.MagicMock]:
        with (
            tenant_context(self.tenant.id),
            mock.patch.object(services, "_queue_alerts") as queued,
        ):
            result = self.mark(
                on_date=on_date, entries=self.register(status=AttendanceStatus.ABSENT)
            )
        return result, queued

    def test_a_register_backfilled_past_the_window_writes_rows_but_alerts_no_one(self) -> None:
        result, queued = self.mark_absent(timezone.localdate() - datetime.timedelta(days=10))

        self.assertEqual(result["marked"], 3)
        self.assertEqual(result["alerts"], [])
        queued.assert_not_called()

    def test_todays_register_still_alerts(self) -> None:
        result, queued = self.mark_absent(timezone.localdate())

        self.assertEqual(len(result["alerts"]), 3)
        queued.assert_called_once()

    def test_a_late_filled_register_inside_the_window_still_alerts(self) -> None:
        configure_academic(self.tenant, attendance_lock_window_days=3)

        result, queued = self.mark_absent(timezone.localdate() - datetime.timedelta(days=2))

        self.assertEqual(len(result["alerts"]), 3)
        queued.assert_called_once()


class CorrectionTests(MarkingTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.approver = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            self.mark(entries=self.register(status=AttendanceStatus.ABSENT))
            self.row = StudentAttendance.objects.alive().get(student=self.students[0])
            self.row.is_locked = True
            self.row.save(update_fields=["is_locked", "updated_at"])

    def request(self, **overrides) -> AttendanceCorrection:
        payload = {
            "target": self.row,
            "new_values": {"status": AttendanceStatus.PRESENT},
            "reason": "The student was in the science lab.",
            "actor_id": self.user.pk,
        }
        return services.request_correction(**{**payload, **overrides})

    def test_a_correction_against_an_unlocked_row_is_refused(self) -> None:
        """While a row is still editable the teacher can re-mark it; a correction
        would ask an approver to authorise something the requester can already
        do."""
        with tenant_context(self.tenant.id):
            unlocked = StudentAttendance.objects.alive().get(student=self.students[1])

            with self.assertRaises(DomainRuleViolation):
                self.request(target=unlocked)

    def test_a_correction_that_changes_nothing_is_refused(self) -> None:
        """§11 — 'new value must differ'."""
        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation):
            self.request(new_values={"status": AttendanceStatus.ABSENT})

    def test_an_approver_cannot_decide_their_own_request(self) -> None:
        """§11 and RBAC §2.4's segregation of duties."""
        with tenant_context(self.tenant.id):
            correction = self.request()

            with self.assertRaises(DomainRuleViolation):
                services.decide_correction(
                    correction=correction, approve=True, reviewer_id=self.user.pk
                )

    def test_approving_applies_the_new_values_and_keeps_the_correction(self) -> None:
        """§6 — the correction row *is* the audit trail, so it stays."""
        with tenant_context(self.tenant.id):
            correction = self.request()

            services.decide_correction(
                correction=correction, approve=True, reviewer_id=self.approver.pk
            )

            self.row.refresh_from_db()
            correction.refresh_from_db()
            self.assertEqual(self.row.status, AttendanceStatus.PRESENT)
            self.assertEqual(correction.status, CorrectionStatus.APPROVED)
            self.assertEqual(correction.old_values["status"], AttendanceStatus.ABSENT)

    def test_rejecting_leaves_the_record_alone(self) -> None:
        with tenant_context(self.tenant.id):
            correction = self.request()

            # The return value, not the argument: `decide_correction` re-reads the
            # row under a lock, so the caller's handle is deliberately not the
            # one that was written. The viewset already uses the return value.
            decided = services.decide_correction(
                correction=correction, approve=False, reviewer_id=self.approver.pk, note="No."
            )

            self.row.refresh_from_db()
            self.assertEqual(self.row.status, AttendanceStatus.ABSENT)
            self.assertEqual(decided.review_note, "No.")

    def test_a_decided_correction_cannot_be_decided_again(self) -> None:
        with tenant_context(self.tenant.id):
            correction = self.request()
            services.decide_correction(
                correction=correction, approve=True, reviewer_id=self.approver.pk
            )

            with self.assertRaises(Conflict):
                services.decide_correction(
                    correction=correction, approve=False, reviewer_id=self.approver.pk
                )

    def test_a_time_survives_the_json_round_trip(self) -> None:
        """`old_values`/`new_values` are JSONB, which has no `time`. Storing the
        ISO string and parsing it back is what keeps an approved correction from
        writing the literal string into a TimeField."""
        with tenant_context(self.tenant.id):
            correction = self.request(
                new_values={
                    "status": AttendanceStatus.LATE,
                    "check_in_time": datetime.time(8, 40),
                }
            )
            services.decide_correction(
                correction=correction, approve=True, reviewer_id=self.approver.pk
            )

            self.row.refresh_from_db()
            self.assertEqual(self.row.check_in_time, datetime.time(8, 40))


class MarkerScopeTests(MarkingTestCase):
    """§11 — the marker must hold `assigned` scope for the section unless `all`."""

    def may_mark(self, user) -> bool:
        with tenant_context(self.tenant.id):
            return may_mark_register(
                user=user, section=self.section, on_date=MARKING_DATE, period=None
            )

    def test_an_all_scoped_user_may_mark_any_section(self) -> None:
        grant(self.user, "attendance.student-attendance.mark", scope=RecordScope.ALL)

        self.assertTrue(self.may_mark(self.user))

    def test_the_sections_class_teacher_may_mark_it(self) -> None:
        teacher_user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            teacher = StaffFactory(tenant=self.tenant, campus=self.campus, user_id=teacher_user.pk)
            self.section.class_teacher_staff_id = teacher.pk
            self.section.save(update_fields=["class_teacher_staff_id", "updated_at"])
        grant(teacher_user, "attendance.student-attendance.mark", scope=RecordScope.ASSIGNED)

        self.assertTrue(self.may_mark(teacher_user))

    def test_a_teacher_of_another_section_may_not_mark_this_one(self) -> None:
        other_user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            StaffFactory(tenant=self.tenant, campus=self.campus, user_id=other_user.pk)
        grant(other_user, "attendance.student-attendance.mark", scope=RecordScope.ASSIGNED)

        self.assertFalse(self.may_mark(other_user))

    def test_own_scope_alone_marks_nothing(self) -> None:
        """A student marking their own register is not a workflow §5 describes."""
        student_user = UserFactory(tenant=self.tenant)
        grant(student_user, "attendance.student-attendance.view", scope=RecordScope.OWN)

        self.assertFalse(self.may_mark(student_user))


class RosterTests(MarkingTestCase):
    def test_the_roster_is_the_sections_active_enrollments(self) -> None:
        with tenant_context(self.tenant.id):
            roster = services.roster_enrollments(section=self.section, session=self.session)

            self.assertEqual({e.student_id for e in roster}, {s.pk for s in self.students})

    def test_a_student_enrolled_elsewhere_is_not_on_this_roster(self) -> None:
        with tenant_context(self.tenant.id):
            other_section = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=self.campus
            )
            elsewhere = StudentFactory(tenant=self.tenant, campus=self.campus)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=elsewhere,
                academic_session=self.session,
                school_class=self.school_class,
                section=other_section,
            )

            roster = services.roster_enrollments(section=self.section, session=self.session)

            self.assertNotIn(elsewhere.pk, {e.student_id for e in roster})
