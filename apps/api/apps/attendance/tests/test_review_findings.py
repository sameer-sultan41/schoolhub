"""Regressions for the ten findings PR #42's review raised.

One class per finding, named for the behaviour rather than the finding number, so
these read as requirements rather than as a changelog. Each was written to fail
against the code as reviewed.
"""

from __future__ import annotations

import datetime
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework import status

from apps.attendance import services
from apps.attendance.models import (
    AttendanceStatus,
    CorrectionStatus,
    StudentAttendance,
)
from apps.attendance.tests.base import AttendanceAPITestCase
from apps.attendance.tests.factories import (
    MARKING_DATE,
    AcademicSessionFactory,
    AttendanceCorrectionFactory,
    CampusFactory,
    ClassFactory,
    SectionFactory,
    StudentAttendanceFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    configure_academic,
    grant,
    open_all_week,
)
from core.api.exceptions import DomainRuleViolation
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

BULK_MARK = "/api/v1/student-attendance:bulk-mark"
CORRECTIONS = "/api/v1/attendance-corrections"


class RestrictedPrincipalsCannotMarkTests(AttendanceAPITestCase):
    """A student or guardian must not be able to write a whole section's register.

    §4 grants the mark key to `teacher`/`class_teacher` only, so a restricted
    principal holding it is already a misconfiguration — the point is that it
    must not also be an escalation. The viewset-wide portal exemption covered
    `:bulk-mark` as well as the reads it was meant for.
    """

    def payload(self) -> dict:
        return {
            "section_id": str(self.section.pk),
            "attendance_date": MARKING_DATE.isoformat(),
            "entries": [
                {"student_id": str(s.pk), "status": AttendanceStatus.PRESENT} for s in self.students
            ],
        }

    def test_a_restricted_principal_holding_the_mark_key_is_still_refused(self) -> None:
        guardian_user = UserFactory(tenant=self.tenant)
        authenticate(self.client, guardian_user)
        grant(
            guardian_user,
            "attendance.student-attendance.mark",
            scope=RecordScope.ALL,
            is_restricted_principal=True,
        )

        response = self.client.post(BULK_MARK, self.payload(), format="json")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        with tenant_context(self.tenant.id):
            self.assertEqual(StudentAttendance.objects.alive().count(), 0)

    def test_a_restricted_principal_can_still_read_their_own_rows(self) -> None:
        """The read exemption is the whole reason this viewset drops the guard;
        the fix must not take it back."""
        student_user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            self.students[0].user_id = student_user.pk
            self.students[0].save(update_fields=["user_id", "updated_at"])
        authenticate(self.client, student_user)
        grant(
            student_user,
            "attendance.student-attendance.view",
            scope=RecordScope.OWN,
            is_restricted_principal=True,
        )

        response = self.client.get("/api/v1/student-attendance")

        self.assertEqual(response.status_code, status.HTTP_200_OK)


class MarkingTestBase(TestCase):
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
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=self.student,
                academic_session=self.session,
                school_class=self.school_class,
                section=self.section,
            )

    def mark(self, *, section=None, status_value=AttendanceStatus.PRESENT, students=None):
        roster = students or [self.student]
        return services.bulk_mark_student_attendance(
            section=section or self.section,
            session=self.session,
            on_date=MARKING_DATE,
            period=None,
            entries=[{"student_id": s.pk, "status": status_value} for s in roster],
            actor_id=self.user.pk,
        )


class SoftDeletedStudentTests(MarkingTestBase):
    def test_a_soft_deleted_student_is_not_markable(self) -> None:
        """`.alive()` narrows the *enrollment*; nothing cascades the student's
        own flag, so a deleted student kept a live enrollment and stayed
        markable — while `section_roster` already excluded them. The roster a
        teacher saw and the roster the validator accepted disagreed."""
        with tenant_context(self.tenant.id):
            self.student.deleted_at = timezone.now()
            self.student.save(update_fields=["deleted_at", "updated_at"])

            with self.assertRaises(DomainRuleViolation) as raised:
                self.mark()

        self.assertIn("Not actively enrolled", str(raised.exception.meta["rows"]))


class SectionOfRecordTests(MarkingTestBase):
    def test_remarking_after_a_section_change_moves_the_row(self) -> None:
        """The lookup matches (student, date, period) because that is what the
        unique indexes enforce — so the new section's teacher finds the existing
        row. Leaving `section` alone put the mark on the old teacher's register
        and inside the wrong campus scope."""
        with tenant_context(self.tenant.id):
            self.mark()
            new_section = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=self.campus
            )
            # A section change *moves* the existing enrollment; it does not add a
            # second one — `student_enrollments_unique_per_session` allows exactly
            # one per (student, session), which is what `change_section` does.
            enrollment = self.student.enrollments.get(academic_session=self.session)
            enrollment.section = new_section
            enrollment.save(update_fields=["section", "updated_at"])

            self.mark(section=new_section, status_value=AttendanceStatus.ABSENT)

            row = StudentAttendance.objects.alive().get(student=self.student)
            self.assertEqual(row.section_id, new_section.pk)
            self.assertEqual(row.status, AttendanceStatus.ABSENT)


class AlertTransitionTests(MarkingTestBase):
    def test_resubmitting_an_unchanged_register_queues_no_new_alerts(self) -> None:
        """§6 requires retries to be safe, so alerting on *current* status meant
        the module's own idempotency promise re-sent every guardian the same
        message on every retry."""
        with tenant_context(self.tenant.id):
            first = self.mark(status_value=AttendanceStatus.ABSENT)
            self.assertEqual(len(first["alerts"]), 1)

            second = self.mark(status_value=AttendanceStatus.ABSENT)

            self.assertEqual(second["updated"], 1)
            self.assertEqual(second["alerts"], [])

    def test_a_correction_from_present_to_absent_does_alert(self) -> None:
        """The transition is what matters, not whether the row is new."""
        with tenant_context(self.tenant.id):
            self.mark(status_value=AttendanceStatus.PRESENT)

            result = self.mark(status_value=AttendanceStatus.ABSENT)

            self.assertEqual(len(result["alerts"]), 1)


class ConcurrentFirstInsertTests(MarkingTestBase):
    def test_a_racing_first_insert_is_merged_rather_than_conflicting(self) -> None:
        """`select_for_update` cannot lock a row that does not exist yet, so two
        simultaneous first submissions both read "absent" and both insert. The
        partial unique index picks a winner and the loser used to surface as a
        409 — on the very case §6 promises is safe.

        Simulated by failing the first `bulk_create` the way the database would,
        which is the only way to exercise the retry deterministically.
        """
        real_lookup = services._lock_existing_rows
        lookups = {"n": 0}

        def blind_first(**kwargs):
            """Answer "no row yet" once, then tell the truth.

            This is the race, faithfully: the other transaction's row is
            *committed* before ours inserts, so ours sees nothing, collides on
            the real partial unique index, and has to recover. Simulating it by
            inserting inside our own transaction does not work — the savepoint
            that catches the IntegrityError rolls that insert back too, which is
            exactly what the first version of this test got wrong.
            """
            lookups["n"] += 1
            if lookups["n"] == 1:
                return {}
            return real_lookup(**kwargs)

        with tenant_context(self.tenant.id):
            # The row the "other" submission already committed.
            self.mark(status_value=AttendanceStatus.PRESENT)

            with mock.patch.object(services, "_lock_existing_rows", side_effect=blind_first):
                result = self.mark(status_value=AttendanceStatus.ABSENT)

            self.assertEqual(lookups["n"], 2, "the retry must re-read after the collision")
            self.assertEqual(result["marked"], 0)
            self.assertEqual(result["updated"], 1)
            self.assertEqual(StudentAttendance.objects.alive().count(), 1)
            self.assertEqual(
                StudentAttendance.objects.alive().get().status, AttendanceStatus.ABSENT
            )


class CorrectionValueTests(AttendanceAPITestCase):
    """The correction workflow is the *other* write path onto an attendance row."""

    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()
        self.approver = UserFactory(tenant=self.tenant)
        grant(
            self.approver,
            "attendance.correction.create",
            "attendance.correction.approve",
            scope=RecordScope.ALL,
        )
        configure_academic(
            self.tenant, day_window={"start": "08:00", "end": "14:00", "grace_minutes": 10}
        )
        with tenant_context(self.tenant.id):
            self.row = StudentAttendanceFactory(
                tenant=self.tenant,
                student=self.students[0],
                section=self.section,
                academic_session=self.session,
                status=AttendanceStatus.ABSENT,
                marked_by=self.user.pk,
                is_locked=True,
            )

    def test_a_correction_cannot_set_a_system_only_status(self) -> None:
        """`on_leave` means "there is an approved leave request". Set through a
        correction it would have no `leave_request` behind it — the back-link
        would be a lie and the leave module would have nothing to withdraw."""
        response = self.client.post(
            CORRECTIONS,
            {
                "student_attendance_id": str(self.row.pk),
                "new_values": {"status": AttendanceStatus.ON_LEAVE},
                "reason": "Trying to fake leave.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_malformed_time_is_refused_when_the_correction_is_raised(self) -> None:
        """Not days later at `:approve`, as an uncaught ValueError → 500, to a
        person who did not write the value."""
        response = self.client.post(
            CORRECTIONS,
            {
                "student_attendance_id": str(self.row.pk),
                "new_values": {
                    "status": AttendanceStatus.LATE,
                    "check_in_time": "half past eight",
                },
                "reason": "Arrived late.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_approving_a_late_correction_recomputes_the_minutes(self) -> None:
        """`late_minutes` is not a correctable field, so it was carried over
        untouched: a row corrected from absent to late reported zero minutes
        late, and §13's punctuality report summed those zeros."""
        created = self.client.post(
            CORRECTIONS,
            {
                "student_attendance_id": str(self.row.pk),
                "new_values": {
                    "status": AttendanceStatus.LATE,
                    "check_in_time": "08:25:00",
                },
                "reason": "Arrived during first period.",
            },
            format="json",
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)

        authenticate(self.client, self.approver)
        response = self.client.post(
            f"{CORRECTIONS}/{created.data['data']['id']}:approve", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        with tenant_context(self.tenant.id):
            self.row.refresh_from_db()
            self.assertEqual(self.row.status, AttendanceStatus.LATE)
            self.assertEqual(self.row.check_in_time, datetime.time(8, 25))
            self.assertEqual(self.row.late_minutes, 25)

    def test_a_malformed_stored_value_is_a_422_not_a_500(self) -> None:
        """Defence in depth: the serializer now blocks this at creation, but a
        row written before that fix — or by a future path — must not crash the
        approver's request."""
        with tenant_context(self.tenant.id):
            correction = AttendanceCorrectionFactory(
                tenant=self.tenant,
                student_attendance=self.row,
                requested_by=self.user.pk,
                new_values={"check_in_time": "half past eight"},
            )

            with self.assertRaises(DomainRuleViolation):
                services.decide_correction(
                    correction=correction, approve=True, reviewer_id=self.approver.pk
                )

    def test_approving_still_clears_minutes_when_the_status_leaves_late(self) -> None:
        with tenant_context(self.tenant.id):
            self.row.status = AttendanceStatus.LATE
            self.row.check_in_time = datetime.time(8, 30)
            self.row.late_minutes = 30
            self.row.save(update_fields=["status", "check_in_time", "late_minutes", "updated_at"])

        created = self.client.post(
            CORRECTIONS,
            {
                "student_attendance_id": str(self.row.pk),
                "new_values": {"status": AttendanceStatus.PRESENT},
                "reason": "Was on time after all.",
            },
            format="json",
        )
        authenticate(self.client, self.approver)
        self.client.post(f"{CORRECTIONS}/{created.data['data']['id']}:approve", {}, format="json")

        with tenant_context(self.tenant.id):
            self.row.refresh_from_db()
            self.assertEqual(self.row.status, AttendanceStatus.PRESENT)
            self.assertIsNone(self.row.late_minutes)
            self.assertEqual(
                CorrectionStatus.APPROVED,
                self.row.corrections.first().status,
            )


class EffectiveLockStateTests(AttendanceAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()

    def test_the_serializer_reports_the_lock_the_write_path_enforces(self) -> None:
        """The column is swept nightly, so between the window passing and the
        sweep running it said False while every write answered 409. A client
        rendering the column alone offered an edit that could not succeed."""
        with tenant_context(self.tenant.id):
            row = StudentAttendanceFactory(
                tenant=self.tenant,
                student=self.students[0],
                section=self.section,
                academic_session=self.session,
                attendance_date=timezone.localdate() - datetime.timedelta(days=3),
                marked_by=self.user.pk,
                is_locked=False,
            )

        response = self.client.get(f"/api/v1/student-attendance/{row.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertTrue(response.data["data"]["is_locked"])

    def test_a_row_inside_the_window_still_reports_unlocked(self) -> None:
        with tenant_context(self.tenant.id):
            row = StudentAttendanceFactory(
                tenant=self.tenant,
                student=self.students[0],
                section=self.section,
                academic_session=self.session,
                attendance_date=timezone.localdate(),
                marked_by=self.user.pk,
            )

        response = self.client.get(f"/api/v1/student-attendance/{row.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertFalse(response.data["data"]["is_locked"])
