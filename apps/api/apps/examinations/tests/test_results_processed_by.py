"""`results.processed_by`: every processing run stamps it, and migration 0011
backfills it from `created_by` for rows processed before it existed."""

from __future__ import annotations

import importlib

from django.apps import apps as django_apps

from apps.examinations import services
from apps.examinations.models import ExamStatus, Result, ResultStatus
from apps.examinations.tests.factories import ResultFactory, UserFactory
from apps.examinations.tests.test_processing import ProcessingTestCase
from apps.examinations.tests.test_result_approval_stamp import ReprocessTestCase
from core.api.exceptions import Conflict, DomainRuleViolation
from core.tenancy.context import tenant_context


class ProcessedByStampTests(ReprocessTestCase):
    def processors(self) -> set:
        with tenant_context(self.tenant.id):
            return set(
                Result.objects.alive().filter(exam=self.exam).values_list("processed_by", flat=True)
            )

    def test_every_row_is_stamped_with_the_processor(self) -> None:
        self.assertEqual(self.processors(), {self.a.pk})

    def test_a_re_process_stamps_every_row_again(self) -> None:
        self.send_back_and_reprocess()

        self.assertEqual(self.processors(), {self.c.pk})
        with tenant_context(self.tenant.id):
            created = set(
                Result.objects.alive().filter(exam=self.exam).values_list("created_by", flat=True)
            )
        self.assertEqual(created, {self.a.pk}, "created_by still names the first run")

    def test_a_re_process_re_stamps_a_pending_row_it_did_not_recompute(self) -> None:
        """A processes, a student is withdrawn, C re-processes: the withdrawn student's row is
        not recomputed but stays pending, so it must name C too, or the gate would refuse A
        (whose stamp it kept) as well as C."""
        from apps.student_management.models import EnrollmentStatus, StudentEnrollment

        withdrawn = self.students[2]
        with tenant_context(self.tenant.id):
            enrollments = StudentEnrollment.objects.filter(student=withdrawn)
            enrollments.update(status=EnrollmentStatus.WITHDRAWN)
            outcome = services.process_exam_results(exam=self.exam, actor_id=self.c.pk)
            stale = Result.objects.alive().get(exam=self.exam, student=withdrawn)

        self.assertEqual(outcome["students"], 2)
        self.assertEqual(stale.status, ResultStatus.PENDING_APPROVAL)
        self.assertEqual(stale.processed_by, self.c.pk)

        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation):
            services.approve_exam_results(exam=self.exam, approver_id=self.c.pk)
        with tenant_context(self.tenant.id):
            approved = services.approve_exam_results(exam=self.exam, approver_id=self.a.pk)
        self.assertEqual(approved, {"approved": 3})

    def test_a_row_sent_back_and_not_recomputed_returns_to_pending_approval(self) -> None:
        """A processes, B sends back (every row to `processing`), a student is withdrawn, C
        re-processes: the withdrawn student's row is not recomputed, so the run itself must
        carry it back to pending, or approval would skip it and it stays `processing` for good."""
        from apps.student_management.models import EnrollmentStatus, StudentEnrollment

        withdrawn = self.students[2]
        with tenant_context(self.tenant.id):
            services.send_results_back(exam=self.exam, actor_id=self.b.pk, reason="Re-key")
            StudentEnrollment.objects.filter(student=withdrawn).update(
                status=EnrollmentStatus.WITHDRAWN
            )
            outcome = services.process_exam_results(exam=self.exam, actor_id=self.c.pk)
            stale = Result.objects.alive().get(exam=self.exam, student=withdrawn)

        self.assertEqual(outcome["students"], 2)
        self.assertEqual(stale.status, ResultStatus.PENDING_APPROVAL)
        self.assertEqual(stale.processed_by, self.c.pk)

        with tenant_context(self.tenant.id):
            approved = services.approve_exam_results(exam=self.exam, approver_id=self.a.pk)
            stale.refresh_from_db()
        self.assertEqual(approved, {"approved": 3})
        self.assertEqual(stale.status, ResultStatus.APPROVED)

    def test_approval_is_refused_while_a_row_is_still_processing(self) -> None:
        """The backstop: a row left in `processing` would never be approved, so the gate
        refuses the whole exam rather than approving around it."""
        straggler = self.students[0]
        with tenant_context(self.tenant.id):
            Result.objects.alive().filter(exam=self.exam, student=straggler).update(
                status=ResultStatus.PROCESSING
            )
            with self.assertRaises(Conflict) as caught:
                services.approve_exam_results(exam=self.exam, approver_id=self.b.pk)
            self.exam.refresh_from_db()
            statuses = set(
                Result.objects.alive().filter(exam=self.exam).values_list("status", flat=True)
            )

        self.assertIn("not been processed yet", str(caught.exception.detail))
        self.assertEqual(self.exam.status, ExamStatus.PROCESSING)
        self.assertNotIn(ResultStatus.APPROVED, statuses)


class ProcessedByBackfillTests(ProcessingTestCase):
    """`0012_results_processed_by`'s data step, `backfill_processed_by`.

    Called directly with the current app registry and no schema editor, so it runs
    against today's models rather than the migration's historical state, and the
    migration executor is not involved. The reverse is `RunPython.noop`: reversing
    the `AddField` drops the column, so there is nothing for it to test.
    """

    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        cls.migration = importlib.import_module(
            "apps.examinations.migrations.0012_results_processed_by"
        )

    def backfill(self) -> None:
        self.migration.backfill_processed_by(django_apps, None)

    def test_a_null_processed_by_is_filled_from_created_by(self) -> None:
        with tenant_context(self.tenant.id):
            processor = UserFactory(tenant=self.tenant)
            legacy = ResultFactory(
                tenant=self.tenant,
                exam=self.exam,
                student=self.students[0],
                section=self.section,
                created_by=processor.pk,
                processed_by=None,
            )

            self.backfill()
            legacy.refresh_from_db()

        self.assertEqual(legacy.processed_by, processor.pk)

    def test_a_stamped_row_is_left_alone(self) -> None:
        with tenant_context(self.tenant.id):
            first, latest = UserFactory(tenant=self.tenant), UserFactory(tenant=self.tenant)
            stamped = ResultFactory(
                tenant=self.tenant,
                exam=self.exam,
                student=self.students[1],
                section=self.section,
                created_by=first.pk,
                processed_by=latest.pk,
            )

            self.backfill()
            stamped.refresh_from_db()

        self.assertEqual(stamped.processed_by, latest.pk)

    def test_every_tenant_is_backfilled_and_the_binding_is_restored(self) -> None:
        """`results` forces RLS, so each tenant is bound in turn; the caller's own
        tenant binding must survive the step."""
        from django.db import connection

        from apps.examinations.tests.factories import (
            AcademicSessionFactory,
            CampusFactory,
            ClassFactory,
            ExamFactory,
            SectionFactory,
            StudentFactory,
            TenantFactory,
            complete_scale,
        )
        from core.tenancy.context import TENANT_GUC

        other = TenantFactory()
        with tenant_context(other.id):
            processor = UserFactory(tenant=other)
            campus = CampusFactory(tenant=other)
            school_class = ClassFactory(tenant=other, level=8)
            foreign = ResultFactory(
                tenant=other,
                exam=ExamFactory(
                    tenant=other,
                    academic_session=AcademicSessionFactory(tenant=other),
                    grading_scale=complete_scale(other),
                ),
                student=StudentFactory(tenant=other, campus=campus),
                section=SectionFactory(tenant=other, school_class=school_class, campus=campus),
                created_by=processor.pk,
            )

        with tenant_context(self.tenant.id):
            self.backfill()
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_setting(%s, true)", [TENANT_GUC])
                bound = cursor.fetchone()[0]

        self.assertEqual(bound, str(self.tenant.id))
        with tenant_context(other.id):
            foreign.refresh_from_db()
        self.assertEqual(foreign.processed_by, processor.pk)
