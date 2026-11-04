"""Seed the parent portal's live-lane fixtures: one record behind each dashboard card.

Run by `seed_e2e_data` (after it has seeded the tenants, users, baseline class and the comms
guardian's child), never on its own against anything but a local or CI database. It lives
in the portal app rather than beside `seed_e2e_data` because it writes through four other
modules' services, and `core` imports no app (ADR-0013). An app reaching another app's
`services` and `models` is the allowed direction.

Idempotent: each fixture has a natural key (a date, a billing period, an exam name, a notice
title), so a re-run converges rather than piling up.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.attendance.models import AttendanceStatus, StudentAttendance
from apps.communication.models import AudienceType, Notice, NoticeStatus, NoticeType
from apps.communication.notices.services.publish import publish_notice
from apps.communication.notices.services.submit import submit_notice
from apps.examinations import services as exam_services
from apps.examinations.models import (
    Exam,
    ExamStatus,
    ExamSubject,
    ExamType,
    GradeBand,
    GradingScale,
    ScaleType,
)
from apps.fees_finance import services as fee_services
from apps.fees_finance.models import (
    FeeFrequency,
    FeeHead,
    FeeHeadCategory,
    FeeSchedule,
    FeeStructure,
    FeeStructureStatus,
)
from apps.school_organization.models import (
    AcademicSession,
    Campus,
    Class,
    Section,
    Subject,
)
from apps.student_management.models import EnrollmentStatus, Student, StudentEnrollment
from core.rbac.management.commands.seed_e2e_data import (
    E2E_ADMIN_EMAIL,
    E2E_CAMPUS_CODE,
    E2E_CLASS_NAME,
    E2E_COMMS_CLASS_TEACHER_EMAIL,
    E2E_COMMS_GUARDIAN_EMAIL,
    E2E_COMMS_STUDENT_ADMISSION_NUMBER,
    E2E_PRINCIPAL_EMAIL,
    E2E_SECTION_NAME,
    E2E_SESSION_NAME,
    E2E_SUBJECT_CODE,
    E2E_TENANT_SLUG,
)
from core.rbac.models import User
from core.tenancy.context import tenant_context
from core.tenancy.models import Tenant

# Parent portal (parent-portal.md §5): the comms guardian's child gets one record per
# dashboard card. Fees, results and the notice go through their module's services, so the
# card reads what production would; attendance rows are written directly (see
# `_ensure_portal_attendance`). Mirrored in e2e/src/lib/seed-constants.ts.
#
# Fees: one active structure for the baseline class billed once, for the session's first
# month. The period label is the idempotency key (`generate_invoices` skips a student
# already billed for it), so a re-seed bills nobody twice.
E2E_FEE_HEAD_CODE = "E2E-TUITION"
E2E_FEE_HEAD_NAME = "E2E Tuition"
E2E_FEE_STRUCTURE_NAME = "E2E Grade 1 Fees"
E2E_FEE_MONTHLY_AMOUNT = Decimal("2500.00")
E2E_FEE_DUE_DAY = 10
# Examinations: one exam over the baseline subject, taken through marks entry, lock,
# processing, approval (by a second person, §4) and publication.
E2E_GRADING_SCALE_NAME = "E2E Letter Scale"
# (label, min_percent, max_percent, grade_point, is_passing): contiguous to two decimals,
# 0 through 100, which §11's scale check requires.
E2E_GRADE_BANDS = (
    ("A", "80.00", "100.00", "4.00", True),
    ("B", "70.00", "79.99", "3.00", True),
    ("C", "60.00", "69.99", "2.00", True),
    ("D", "50.00", "59.99", "1.00", True),
    ("F", "0.00", "49.99", "0.00", False),
)
E2E_EXAM_NAME = "E2E Midterm"
E2E_EXAM_MAX_MARKS = Decimal("100.00")
# Out of 100 at full weight, so the result's percentage is this figure and its grade "B".
E2E_EXAM_THEORY_MARKS = Decimal("78.00")
# Communication: one published notice to the comms guardian alone, needing acknowledgement.
E2E_NOTICE_TITLE = "E2E Sports Day"
E2E_NOTICE_BODY = "Sports day is on Friday. Please acknowledge that you have read this notice."


class Command(BaseCommand):
    help = (
        "Seed the parent-portal live-lane fixtures for the comms guardian's child: "
        "attendance, an outstanding invoice, a published result and a notice. Run by "
        "seed_e2e_data."
    )

    @transaction.atomic
    def handle(self, *args, **options):
        tenant = Tenant.objects.get(slug=E2E_TENANT_SLUG)
        users = {
            user.email: user
            for user in User.objects.filter(
                tenant=tenant,
                email__in=[
                    E2E_ADMIN_EMAIL,
                    E2E_PRINCIPAL_EMAIL,
                    E2E_COMMS_GUARDIAN_EMAIL,
                    E2E_COMMS_CLASS_TEACHER_EMAIL,
                ],
            )
        }
        admin = users[E2E_ADMIN_EMAIL]
        principal = users[E2E_PRINCIPAL_EMAIL]

        with tenant_context(tenant.id):
            session = AcademicSession.objects.get(name=E2E_SESSION_NAME)
            campus = Campus.objects.get(code=E2E_CAMPUS_CODE)
            school_class = Class.objects.get(name=E2E_CLASS_NAME)
            section = Section.objects.get(
                school_class=school_class, campus=campus, name=E2E_SECTION_NAME
            )
            subject = Subject.objects.get(code=E2E_SUBJECT_CODE)
            student = Student.objects.get(admission_number=E2E_COMMS_STUDENT_ADMISSION_NUMBER)

            self._ensure_portal_attendance(
                tenant,
                student=student,
                section=section,
                session=session,
                marked_by=users[E2E_COMMS_CLASS_TEACHER_EMAIL].id,
            )
            self._ensure_portal_invoice(
                tenant, session=session, school_class=school_class, campus=campus, actor=admin
            )
            self._ensure_published_result(
                tenant,
                session=session,
                school_class=school_class,
                subject=subject,
                marker=admin,
                approver=principal,
            )
            self._ensure_portal_notice(
                tenant,
                drafter=admin,
                approver=principal,
                recipient=users[E2E_COMMS_GUARDIAN_EMAIL],
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded the parent-portal fixtures for {E2E_COMMS_STUDENT_ADMISSION_NUMBER}"
            )
        )

    def _ensure_portal_attendance(
        self,
        tenant: Tenant,
        *,
        student: Student,
        section: Section,
        session: AcademicSession,
        marked_by: uuid.UUID,
    ) -> None:
        """Today present and, when it is in the same month, yesterday absent.

        Daily rows (`period=None`), keyed by date, so a re-run on the same day changes
        nothing and a run on a later day adds that day. Written through the ORM: the
        register service sends the absence alert, which is not what a fixture is for.
        "Today" is the tenant's own date, the one the dashboard card reads.
        """
        today = tenant.local_date()
        days = [(today, AttendanceStatus.PRESENT)]
        yesterday = today - timedelta(days=1)
        if yesterday.month == today.month and yesterday >= session.start_date:
            days.append((yesterday, AttendanceStatus.ABSENT))
        for on_date, status in days:
            StudentAttendance.objects.get_or_create(
                tenant=tenant,
                student=student,
                attendance_date=on_date,
                period=None,
                defaults={
                    "section": section,
                    "academic_session": session,
                    "status": status,
                    "marked_by": marked_by,
                },
            )

    def _ensure_portal_invoice(
        self,
        tenant: Tenant,
        *,
        session: AcademicSession,
        school_class: Class,
        campus: Campus,
        actor: User,
    ) -> None:
        """One issued, unpaid invoice per enrolled baseline-class student, via `fees_finance`.

        The structure, head and schedule are configuration and are found again by their
        natural keys; the invoice itself comes from `generate_invoices` for the session's
        first month, whose duplicate guard skips a student already billed for that
        period. So a re-seed bills nobody twice, and the comms child always owes exactly
        `E2E_FEE_MONTHLY_AMOUNT` on one invoice.
        """
        accounts = fee_services.ensure_system_accounts(tenant_id=tenant.id)
        head, _ = FeeHead.objects.get_or_create(
            tenant=tenant,
            code=E2E_FEE_HEAD_CODE,
            defaults={
                "name": E2E_FEE_HEAD_NAME,
                "category": FeeHeadCategory.TUITION,
                "ledger_account": accounts["4000"],
            },
        )
        structure, _ = FeeStructure.objects.get_or_create(
            tenant=tenant,
            academic_session=session,
            school_class=school_class,
            campus=campus,
            name=E2E_FEE_STRUCTURE_NAME,
        )
        FeeSchedule.objects.get_or_create(
            tenant=tenant,
            fee_structure=structure,
            fee_head=head,
            defaults={
                "amount": E2E_FEE_MONTHLY_AMOUNT,
                "frequency": FeeFrequency.MONTHLY,
                "due_day": E2E_FEE_DUE_DAY,
            },
        )
        if structure.status == FeeStructureStatus.DRAFT:
            structure = fee_services.activate_fee_structure(structure=structure, actor_id=actor.id)
        fee_services.generate_invoices(
            structure=structure,
            period_start=session.start_date,
            actor_id=actor.id,
            tenant_id=tenant.id,
        )

    def _ensure_published_result(
        self,
        tenant: Tenant,
        *,
        session: AcademicSession,
        school_class: Class,
        subject: Subject,
        marker: User,
        approver: User,
    ) -> None:
        """A published result for every enrolled baseline-class student, via the real chain.

        exam -> exam-subject -> `bulk_enter_marks` -> `lock_marks` -> `process_exam_results`
        -> `approve_exam_results` -> `publish_exam_results`. The configuration rows are
        written directly, as `_ensure_curriculum` does; everything that decides a result
        goes through `examinations.services`, so the guardian's card shows what the
        module itself would publish.

        Two people, as §4 requires: the owner enters marks and processes, the principal
        approves and publishes (`assert_approver_is_not_the_processor`). Processing needs
        a mark for every active enrolment in the class (§11), so every one gets the same
        mark. The exam's name is the idempotency key: once it exists the whole chain has
        run, because this command is one transaction.
        """
        if Exam.objects.alive().filter(academic_session=session, name=E2E_EXAM_NAME).exists():
            return

        scale, created = GradingScale.objects.get_or_create(
            tenant=tenant,
            name=E2E_GRADING_SCALE_NAME,
            defaults={"scale_type": ScaleType.HYBRID, "gpa_max": Decimal("4.00")},
        )
        if created:
            GradeBand.objects.bulk_create(
                GradeBand(
                    tenant=tenant,
                    grading_scale=scale,
                    label=label,
                    min_percent=Decimal(low),
                    max_percent=Decimal(high),
                    grade_point=Decimal(point),
                    is_passing=passing,
                    sort_order=order,
                )
                for order, (label, low, high, point, passing) in enumerate(E2E_GRADE_BANDS)
            )

        exam = Exam.objects.create(
            tenant=tenant,
            academic_session=session,
            name=E2E_EXAM_NAME,
            exam_type=ExamType.MIDTERM,
            grading_scale=scale,
            status=ExamStatus.SCHEDULED,
            created_by=marker.id,
            updated_by=marker.id,
        )
        exam_subject = ExamSubject.objects.create(
            tenant=tenant,
            exam=exam,
            school_class=school_class,
            subject=subject,
            max_marks=E2E_EXAM_MAX_MARKS,
            pass_marks=Decimal("40.00"),
            created_by=marker.id,
            updated_by=marker.id,
        )

        roll = StudentEnrollment.objects.alive().filter(
            academic_session=session,
            school_class=school_class,
            status=EnrollmentStatus.ACTIVE,
        )
        exam_services.bulk_enter_marks(
            exam_subject=exam_subject,
            entries=[
                {"student_id": student_id, "theory_marks": E2E_EXAM_THEORY_MARKS}
                for student_id in roll.values_list("student_id", flat=True).distinct()
            ],
            user=marker,
            actor_id=marker.id,
        )
        exam_services.lock_marks(exam_subject=exam_subject, actor_id=marker.id)
        exam_services.process_exam_results(exam=exam, actor_id=marker.id)
        exam_services.approve_exam_results(exam=exam, approver_id=approver.id)
        exam_services.publish_exam_results(exam=exam, actor_id=approver.id)

    def _ensure_portal_notice(
        self, tenant: Tenant, *, drafter: User, approver: User, recipient: User
    ) -> None:
        """One published notice sent to the comms guardian only, needing acknowledgement.

        Drafted by the owner and published by the principal through the notice services,
        so the fan-out writes the guardian's `Notification` row that the portal's notice
        list and `:acknowledge` read. A custom audience of one user keeps it out of every
        other identity's inbox. The title is the idempotency key.
        """
        if Notice.objects.alive().filter(title=E2E_NOTICE_TITLE).exists():
            return
        notice = Notice.objects.create(
            tenant=tenant,
            title=E2E_NOTICE_TITLE,
            body=E2E_NOTICE_BODY,
            notice_type=NoticeType.GENERAL,
            audience_type=AudienceType.CUSTOM,
            audience_filter={"user_ids": [str(recipient.id)]},
            requires_acknowledgment=True,
            status=NoticeStatus.DRAFT,
            created_by=drafter.id,
            updated_by=drafter.id,
        )
        notice = submit_notice(notice, actor_id=drafter.id)
        publish_notice(notice, actor_id=approver.id)
