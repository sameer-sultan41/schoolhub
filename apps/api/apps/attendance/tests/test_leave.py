"""The student leave flow — §5.4, §7.2, §11.

Driven through the service, like test_marking.py, because §7.2's chain has to
hold identically when `hr-leave` (Tier 6) decides a staff request through its own
endpoint. A rule proved only through HTTP is a rule that module can skip.
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from apps.attendance import services
from apps.attendance.models import (
    ApprovalDecision,
    AttendanceStatus,
    DayPart,
    LeaveAppliesTo,
    LeaveStatus,
    LeaveType,
    StudentAttendance,
)
from apps.attendance.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    GuardianFactory,
    SectionFactory,
    StudentAttendanceFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    StudentGuardianFactory,
    TenantFactory,
    UserFactory,
    configure_academic,
    grant,
    holiday,
    open_all_week,
)
from core.api.exceptions import Conflict, DomainRuleViolation
from core.tenancy.context import tenant_context


def next_monday(offset_weeks: int = 1) -> datetime.date:
    """A date safely in the future — §6 forbids cancelling once leave has started."""
    today = timezone.localdate()
    return today + datetime.timedelta(days=(7 - today.weekday()) + 7 * (offset_weeks - 1))


class LeaveTestCase(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.guardian_user = UserFactory(tenant=self.tenant)
        self.approver = UserFactory(tenant=self.tenant)
        self.second_approver = UserFactory(tenant=self.tenant)
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
            self.guardian = GuardianFactory(tenant=self.tenant, user_id=self.guardian_user.pk)
            self.link = StudentGuardianFactory(
                tenant=self.tenant,
                student=self.student,
                guardian=self.guardian,
                has_portal_access=True,
            )
            self.leave_type = LeaveType.objects.create(
                tenant=self.tenant,
                name="Sick Leave",
                code="SICK",
                applies_to=LeaveAppliesTo.BOTH,
            )

    def submit(self, **overrides):
        start = overrides.pop("start_date", next_monday())
        payload = {
            "student": self.student,
            "leave_type": self.leave_type,
            "start_date": start,
            "end_date": overrides.pop("end_date", start + datetime.timedelta(days=2)),
            "day_part": DayPart.FULL,
            "reason": "Chickenpox.",
            "submitted_by": self.guardian_user.pk,
            "requesting_user": self.guardian_user,
        }
        return services.submit_leave_request(**{**payload, **overrides})


class SubmissionTests(LeaveTestCase):
    def test_a_linked_guardian_may_submit_for_their_child(self) -> None:
        with tenant_context(self.tenant.id):
            request = self.submit()

            self.assertEqual(request.status, LeaveStatus.PENDING)
            self.assertEqual(request.days_count, Decimal("3.0"))
            self.assertEqual(request.approvals.count(), 1)

    def test_an_unlinked_user_may_not_submit_for_a_child(self) -> None:
        """§11 — "requester must be the student or a linked guardian"."""
        stranger = UserFactory(tenant=self.tenant)

        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation):
            self.submit(submitted_by=stranger.pk, requesting_user=stranger)

    def test_a_guardian_whose_portal_access_was_revoked_may_not_submit(self) -> None:
        """The same gate the read scope uses. Two rules that must agree,
        implemented once — `Student.filter_owned_by_user`."""
        with tenant_context(self.tenant.id):
            self.link.has_portal_access = False
            self.link.save(update_fields=["has_portal_access", "updated_at"])

            with self.assertRaises(DomainRuleViolation):
                self.submit()

    def test_a_staff_only_leave_type_is_refused(self) -> None:
        with tenant_context(self.tenant.id):
            staff_only = LeaveType.objects.create(
                tenant=self.tenant, name="Casual", code="CAS", applies_to=LeaveAppliesTo.STAFF
            )

            with self.assertRaises(DomainRuleViolation):
                self.submit(leave_type=staff_only)

    def test_an_inactive_leave_type_is_refused(self) -> None:
        with tenant_context(self.tenant.id):
            self.leave_type.is_active = False
            self.leave_type.save(update_fields=["is_active", "updated_at"])

            with self.assertRaises(DomainRuleViolation):
                self.submit()

    def test_an_overlapping_request_is_refused(self) -> None:
        """§11 — overlap with an *existing approved or pending* request."""
        with tenant_context(self.tenant.id):
            self.submit()

            with self.assertRaises(DomainRuleViolation):
                self.submit(start_date=next_monday() + datetime.timedelta(days=1))

    def test_a_cancelled_request_does_not_block_a_second_one(self) -> None:
        """Overlap is about live claims, not history: a family that cancels and
        re-books the same week must not be stuck."""
        with tenant_context(self.tenant.id):
            first = self.submit()
            services.cancel_leave_request(request=first, actor_id=self.guardian_user.pk)

            second = self.submit()

            self.assertEqual(second.status, LeaveStatus.PENDING)

    def test_an_attachment_is_required_when_the_type_demands_one(self) -> None:
        with tenant_context(self.tenant.id):
            self.leave_type.requires_attachment = True
            self.leave_type.save(update_fields=["requires_attachment", "updated_at"])

            with self.assertRaises(DomainRuleViolation):
                self.submit()

    def test_dates_ending_before_they_start_are_refused(self) -> None:
        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation):
            self.submit(end_date=next_monday() - datetime.timedelta(days=3))

    def test_a_range_longer_than_the_types_maximum_is_refused(self) -> None:
        with tenant_context(self.tenant.id):
            self.leave_type.max_consecutive_days = 2
            self.leave_type.save(update_fields=["max_consecutive_days", "updated_at"])

            with self.assertRaises(DomainRuleViolation):
                self.submit()


class DaysCountTests(LeaveTestCase):
    def test_days_count_is_net_of_non_working_days(self) -> None:
        """§11. A request that counted a Sunday would be a false attendance
        record for a student and a balance error for staff once hr-leave reads
        the same column."""
        monday = next_monday()
        configure_academic(self.tenant, working_days=[0, 1, 2, 3, 4])

        with tenant_context(self.tenant.id):
            # Monday to the following Monday: eight calendar days, six working.
            request = self.submit(start_date=monday, end_date=monday + datetime.timedelta(days=7))

            self.assertEqual(request.days_count, Decimal("6.0"))

    def test_days_count_is_net_of_holidays(self) -> None:
        monday = next_monday()
        eid = (monday + datetime.timedelta(days=1)).isoformat()
        configure_academic(self.tenant, holidays=[holiday(eid, "Eid")])

        with tenant_context(self.tenant.id):
            request = self.submit(start_date=monday, end_date=monday + datetime.timedelta(days=2))

            self.assertEqual(request.days_count, Decimal("2.0"))

    def test_a_half_day_counts_as_half(self) -> None:
        monday = next_monday()

        with tenant_context(self.tenant.id):
            request = self.submit(start_date=monday, end_date=monday, day_part=DayPart.FIRST_HALF)

            self.assertEqual(request.days_count, Decimal("0.5"))

    def test_a_range_that_is_entirely_holidays_is_refused(self) -> None:
        """Zero days of leave is not a request; it is a mistake worth naming."""
        monday = next_monday()
        configure_academic(self.tenant, working_days=[5, 6])

        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation):
            self.submit(start_date=monday, end_date=monday + datetime.timedelta(days=2))


class ApprovalChainTests(LeaveTestCase):
    def test_a_short_request_needs_one_approval(self) -> None:
        with tenant_context(self.tenant.id):
            request = self.submit()

            decided = services.decide_leave_step(
                request=request, approve=True, approver_id=self.approver.pk
            )

            self.assertEqual(decided.status, LeaveStatus.APPROVED)

    def test_a_long_request_escalates_to_a_second_level(self) -> None:
        """§7.2 and §8's "a two-week request escalates automatically"."""
        monday = next_monday()

        with tenant_context(self.tenant.id):
            request = self.submit(start_date=monday, end_date=monday + datetime.timedelta(days=13))
            self.assertEqual(request.approvals.count(), 2)

            after_first = services.decide_leave_step(
                request=request, approve=True, approver_id=self.approver.pk
            )

            self.assertEqual(after_first.status, LeaveStatus.PENDING)
            self.assertEqual(after_first.current_approval_level, 2)

            after_second = services.decide_leave_step(
                request=after_first, approve=True, approver_id=self.second_approver.pk
            )

            self.assertEqual(after_second.status, LeaveStatus.APPROVED)

    def test_one_person_cannot_decide_both_levels(self) -> None:
        """Without this the escalation is theatre: the class teacher who approved
        level 1 could approve level 2 and the second opinion would be their own."""
        monday = next_monday()

        with tenant_context(self.tenant.id):
            request = self.submit(start_date=monday, end_date=monday + datetime.timedelta(days=13))
            after_first = services.decide_leave_step(
                request=request, approve=True, approver_id=self.approver.pk
            )

            with self.assertRaises(DomainRuleViolation):
                services.decide_leave_step(
                    request=after_first, approve=True, approver_id=self.approver.pk
                )

    def test_the_submitter_cannot_approve_their_own_request(self) -> None:
        """§11 and RBAC §2.4."""
        with tenant_context(self.tenant.id):
            request = self.submit()

            with self.assertRaises(DomainRuleViolation):
                services.decide_leave_step(
                    request=request, approve=True, approver_id=self.guardian_user.pk
                )

    def test_a_rejection_ends_the_request_at_any_level(self) -> None:
        """§7.2's flowchart has one arrow out of a rejection; there is no partial
        rejection to represent."""
        monday = next_monday()

        with tenant_context(self.tenant.id):
            request = self.submit(start_date=monday, end_date=monday + datetime.timedelta(days=13))

            decided = services.decide_leave_step(
                request=request, approve=False, approver_id=self.approver.pk, note="No."
            )

            self.assertEqual(decided.status, LeaveStatus.REJECTED)
            self.assertEqual(decided.approvals.get(level=1).decision, ApprovalDecision.REJECTED)

    def test_a_decided_request_cannot_be_decided_again(self) -> None:
        with tenant_context(self.tenant.id):
            request = self.submit()
            services.decide_leave_step(request=request, approve=True, approver_id=self.approver.pk)

            with self.assertRaises(Conflict):
                services.decide_leave_step(
                    request=request, approve=False, approver_id=self.second_approver.pk
                )

    def test_the_escalation_threshold_is_tenant_configurable(self) -> None:
        configure_academic(self.tenant, student_leave_approval={"escalation_threshold_days": 2})
        monday = next_monday()

        with tenant_context(self.tenant.id):
            request = self.submit(start_date=monday, end_date=monday + datetime.timedelta(days=2))

            self.assertEqual(request.approvals.count(), 2)

    def test_a_zero_threshold_is_floored_rather_than_escalating_everything(self) -> None:
        configure_academic(self.tenant, student_leave_approval={"escalation_threshold_days": 0})

        with tenant_context(self.tenant.id):
            self.assertEqual(services.escalation_threshold_days(), 1)


class AutoMarkingTests(LeaveTestCase):
    def test_approval_marks_the_dates_on_leave(self) -> None:
        """§7.2 — "dates auto-marked on_leave"."""
        monday = next_monday()

        with tenant_context(self.tenant.id):
            request = self.submit(start_date=monday, end_date=monday + datetime.timedelta(days=2))
            services.decide_leave_step(request=request, approve=True, approver_id=self.approver.pk)

            rows = StudentAttendance.objects.alive().filter(student=self.student)
            self.assertEqual(rows.count(), 3)
            self.assertEqual({row.status for row in rows}, {AttendanceStatus.ON_LEAVE})
            self.assertEqual({row.leave_request_id for row in rows}, {request.pk})

    def test_non_working_days_inside_the_range_get_no_row(self) -> None:
        configure_academic(self.tenant, working_days=[0, 1, 2, 3, 4])
        monday = next_monday()

        with tenant_context(self.tenant.id):
            request = self.submit(start_date=monday, end_date=monday + datetime.timedelta(days=6))
            services.decide_leave_step(request=request, approve=True, approver_id=self.approver.pk)

            self.assertEqual(
                StudentAttendance.objects.alive().filter(student=self.student).count(), 5
            )

    def test_a_date_the_teacher_already_marked_is_left_alone(self) -> None:
        """A student recorded present is a fact; the approval is a claim about the
        future. Overwriting would let a back-dated approval rewrite the register."""
        monday = next_monday()

        with tenant_context(self.tenant.id):
            existing = StudentAttendanceFactory(
                tenant=self.tenant,
                student=self.student,
                section=self.section,
                academic_session=self.session,
                attendance_date=monday,
                status=AttendanceStatus.PRESENT,
                marked_by=self.approver.pk,
            )
            request = self.submit(start_date=monday, end_date=monday + datetime.timedelta(days=1))
            services.decide_leave_step(request=request, approve=True, approver_id=self.approver.pk)

            existing.refresh_from_db()
            self.assertEqual(existing.status, AttendanceStatus.PRESENT)
            self.assertEqual(
                StudentAttendance.objects.alive().filter(student=self.student).count(), 2
            )

    def test_a_rejection_marks_nothing(self) -> None:
        with tenant_context(self.tenant.id):
            request = self.submit()
            services.decide_leave_step(request=request, approve=False, approver_id=self.approver.pk)

            self.assertEqual(
                StudentAttendance.objects.alive().filter(student=self.student).count(), 0
            )


class CancellationTests(LeaveTestCase):
    def test_a_pending_request_can_be_cancelled_before_it_starts(self) -> None:
        with tenant_context(self.tenant.id):
            request = self.submit()

            cancelled = services.cancel_leave_request(
                request=request, actor_id=self.guardian_user.pk
            )

            self.assertEqual(cancelled.status, LeaveStatus.CANCELLED)

    def test_cancelling_an_approved_request_withdraws_its_auto_marked_rows(self) -> None:
        """A child who recovers early should come back to school without an
        `on_leave` row saying otherwise."""
        with tenant_context(self.tenant.id):
            request = self.submit()
            services.decide_leave_step(request=request, approve=True, approver_id=self.approver.pk)
            self.assertEqual(
                StudentAttendance.objects.alive().filter(student=self.student).count(), 3
            )

            services.cancel_leave_request(request=request, actor_id=self.guardian_user.pk)

            self.assertEqual(
                StudentAttendance.objects.alive().filter(student=self.student).count(), 0
            )

    def test_cancelling_leaves_a_teachers_own_row_alone(self) -> None:
        """Filtered on the back-link, not on dates: a row the teacher marked over
        the same range is not this request's to remove."""
        monday = next_monday()

        with tenant_context(self.tenant.id):
            teacher_row = StudentAttendanceFactory(
                tenant=self.tenant,
                student=self.student,
                section=self.section,
                academic_session=self.session,
                attendance_date=monday,
                status=AttendanceStatus.PRESENT,
                marked_by=self.approver.pk,
            )
            request = self.submit(start_date=monday, end_date=monday + datetime.timedelta(days=1))
            services.decide_leave_step(request=request, approve=True, approver_id=self.approver.pk)
            services.cancel_leave_request(request=request, actor_id=self.guardian_user.pk)

            teacher_row.refresh_from_db()
            self.assertIsNone(teacher_row.deleted_at)

    def test_leave_that_has_already_started_cannot_be_cancelled(self) -> None:
        """§6 — "cancellation allowed until start date"."""
        with tenant_context(self.tenant.id):
            request = self.submit()
            request.start_date = timezone.localdate()
            request.save(update_fields=["start_date", "updated_at"])

            with self.assertRaises(DomainRuleViolation):
                services.cancel_leave_request(request=request, actor_id=self.guardian_user.pk)

    def test_a_rejected_request_cannot_be_cancelled(self) -> None:
        with tenant_context(self.tenant.id):
            request = self.submit()
            services.decide_leave_step(request=request, approve=False, approver_id=self.approver.pk)

            with self.assertRaises(Conflict):
                services.cancel_leave_request(request=request, actor_id=self.guardian_user.pk)


class LeaveWritePathRaceTests(LeaveTestCase):
    """The two directions the register and the leave module can collide."""

    def test_a_teacher_cannot_mark_over_an_approved_leave_day(self) -> None:
        """The guard in the direction that was missing. `apply_approved_leave`
        already refuses to overwrite a teacher's mark; without this, marking
        silently overwrote an approved-leave day and left `leave_request`
        pointing at a request whose dates the row no longer reflected."""
        from apps.attendance import services as attendance_services
        from apps.attendance.models import AttendanceStatus

        monday = next_monday()
        with tenant_context(self.tenant.id):
            request = self.submit(start_date=monday, end_date=monday)
            services.decide_leave_step(request=request, approve=True, approver_id=self.approver.pk)

            with self.assertRaises(DomainRuleViolation) as raised:
                attendance_services.bulk_mark_student_attendance(
                    section=self.section,
                    session=self.session,
                    on_date=monday,
                    period=None,
                    entries=[{"student_id": self.student.pk, "status": AttendanceStatus.PRESENT}],
                    actor_id=self.approver.pk,
                )

            self.assertIn("approved leave", str(raised.exception.meta["rows"]))
            row = StudentAttendance.objects.alive().get(student=self.student)
            self.assertEqual(row.status, AttendanceStatus.ON_LEAVE)
            self.assertEqual(row.leave_request_id, request.pk)

    def test_auto_marked_rows_record_the_system_as_their_source(self) -> None:
        """They said `manual`, which was untrue — no person marked them — so
        §13's reports had no way to tell a teacher's mark from the leave
        module's."""
        from apps.attendance.models import AttendanceSource

        with tenant_context(self.tenant.id):
            request = self.submit()
            services.decide_leave_step(request=request, approve=True, approver_id=self.approver.pk)

            sources = set(
                StudentAttendance.objects.alive()
                .filter(leave_request=request)
                .values_list("source", flat=True)
            )
            self.assertEqual(sources, {AttendanceSource.SYSTEM})

    def test_a_teacher_marking_mid_approval_does_not_roll_back_the_approval(self) -> None:
        """The race the savepoint exists for. Without it an IntegrityError from
        the auto-mark rolled back **the approval decision itself** and 500'd the
        approver — the leave refused because someone took a register."""
        from unittest import mock

        from apps.attendance.models import AttendanceStatus

        monday = next_monday()
        with tenant_context(self.tenant.id):
            request = self.submit(start_date=monday, end_date=monday)

            real_filter = StudentAttendance.objects.alive
            calls = {"n": 0}

            def blind_first(*args, **kwargs):
                """Report "nothing marked yet" once, then tell the truth."""
                calls["n"] += 1
                if calls["n"] == 1:
                    StudentAttendanceFactory(
                        tenant=self.tenant,
                        student=self.student,
                        section=self.section,
                        academic_session=self.session,
                        attendance_date=monday,
                        status=AttendanceStatus.PRESENT,
                        marked_by=self.approver.pk,
                    )
                    return real_filter().none()
                return real_filter(*args, **kwargs)

            with mock.patch.object(StudentAttendance.objects, "alive", side_effect=blind_first):
                decided = services.decide_leave_step(
                    request=request, approve=True, approver_id=self.approver.pk
                )

            self.assertEqual(decided.status, LeaveStatus.APPROVED)
            # The teacher's row stands; the auto-mark added nothing over it.
            row = StudentAttendance.objects.alive().get(student=self.student)
            self.assertEqual(row.status, AttendanceStatus.PRESENT)


class EscalationScopeTests(LeaveTestCase):
    def test_level_two_needs_an_approver_who_can_see_wider(self) -> None:
        """ "Two different people" was not enough: §4 grants the approve key to
        class_teacher, vice_principal and principal alike, so two assigned-scoped
        class teachers could decide both levels — and a request that escalated
        *because it was long* would be settled entirely inside the scope that
        raised it."""
        from core.rbac.models import RecordScope

        monday = next_monday()
        narrow_approver = UserFactory(tenant=self.tenant)
        grant(
            narrow_approver,
            "attendance.leave-request.approve",
            scope=RecordScope.ASSIGNED,
        )

        with tenant_context(self.tenant.id):
            request = self.submit(start_date=monday, end_date=monday + datetime.timedelta(days=13))
            after_first = services.decide_leave_step(
                request=request, approve=True, approver_id=self.approver.pk
            )

            with self.assertRaises(DomainRuleViolation):
                services.decide_leave_step(
                    request=after_first, approve=True, approver_id=narrow_approver.pk
                )

    def test_a_campus_scoped_approver_satisfies_level_two(self) -> None:
        from core.rbac.models import RecordScope

        monday = next_monday()
        wide_approver = UserFactory(tenant=self.tenant)
        grant(
            wide_approver,
            "attendance.leave-request.approve",
            scope=RecordScope.CAMPUS,
            scope_ref=self.campus.pk,
        )

        with tenant_context(self.tenant.id):
            request = self.submit(start_date=monday, end_date=monday + datetime.timedelta(days=13))
            after_first = services.decide_leave_step(
                request=request, approve=True, approver_id=self.approver.pk
            )

            decided = services.decide_leave_step(
                request=after_first, approve=True, approver_id=wide_approver.pk
            )

        self.assertEqual(decided.status, LeaveStatus.APPROVED)

    def test_level_one_is_unaffected_by_the_scope_rule(self) -> None:
        """A short request has one level and must stay decidable by a class
        teacher — the rule is about escalation, not about approving at all."""
        from core.rbac.models import RecordScope

        narrow_approver = UserFactory(tenant=self.tenant)
        grant(
            narrow_approver,
            "attendance.leave-request.approve",
            scope=RecordScope.ASSIGNED,
        )

        with tenant_context(self.tenant.id):
            request = self.submit()

            decided = services.decide_leave_step(
                request=request, approve=True, approver_id=narrow_approver.pk
            )

        self.assertEqual(decided.status, LeaveStatus.APPROVED)
