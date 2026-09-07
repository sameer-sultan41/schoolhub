"""§5.5's result processing and §5.6's approval chain.

Four of these cases pin rules a school will argue about, and each is here
because the wrong answer is plausible:

- an **absent** student is `outcome=absent`, not a zero that ranks them last
  and drags the section's pass rate down;
- an **exempt** subject shrinks the denominator rather than scoring zero;
- **ties share a rank** — two students on 91% are both second;
- the **approver cannot be the processor**, which is the one rule in this
  module that exists purely to stop one person completing a two-person process.
"""

from __future__ import annotations

from decimal import Decimal

from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework import status
from rest_framework.test import APIClient

from apps.examinations import processing, services
from apps.examinations.models import (
    ExamStatus,
    MarksStatus,
    Result,
    ResultOutcome,
    ResultStatus,
)
from apps.examinations.tests.base import ExaminationsAPITestCase
from apps.examinations.tests.factories import (
    ClassSubjectFactory,
    ExamFactory,
    ExamSubjectFactory,
    MarksFactory,
    SubjectFactory,
    UserFactory,
    authenticate,
    grant,
)
from core.api.exceptions import Conflict, DomainRuleViolation
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context


class ProcessingTestCase(ExaminationsAPITestCase):
    """One exam, one subject out of 100, three enrolled students."""

    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()
        with tenant_context(self.tenant.id):
            self.exam = ExamFactory(
                tenant=self.tenant,
                academic_session=self.session,
                grading_scale=self.scale,
                status=ExamStatus.MARKS_ENTRY,
            )
            self.exam_subject = ExamSubjectFactory(
                tenant=self.tenant,
                exam=self.exam,
                school_class=self.school_class,
                subject=self.subject,
                max_marks=Decimal("100.00"),
                pass_marks=Decimal("40.00"),
            )

    def mark(self, student, **kwargs):
        defaults = {
            "tenant": self.tenant,
            "exam_subject": self.exam_subject,
            "student": student,
            "entered_by": self.user.pk,
            "status": MarksStatus.SUBMITTED,
        }
        defaults.update(kwargs)
        return MarksFactory(**defaults)

    def mark_all(self, *scores: str):
        with tenant_context(self.tenant.id):
            for student, score in zip(self.students, scores, strict=True):
                self.mark(student, theory_marks=Decimal(score))

    def second_subject(self, **kwargs):
        with tenant_context(self.tenant.id):
            subject = SubjectFactory(tenant=self.tenant)
            ClassSubjectFactory(
                tenant=self.tenant,
                academic_session=self.session,
                school_class=self.school_class,
                subject=subject,
            )
            return ExamSubjectFactory(
                tenant=self.tenant,
                exam=self.exam,
                school_class=self.school_class,
                subject=subject,
                max_marks=Decimal("100.00"),
                pass_marks=Decimal("40.00"),
                **kwargs,
            )

    def process(self):
        with tenant_context(self.tenant.id):
            return services.process_exam_results(exam=self.exam, actor_id=self.user.pk)

    def results(self) -> dict:
        with tenant_context(self.tenant.id):
            return {row.student_id: row for row in Result.objects.alive().filter(exam=self.exam)}


class ReadinessTests(ProcessingTestCase):
    def test_processing_is_blocked_while_marks_are_outstanding(self) -> None:
        """§11, measured against the *expected roll* — a subject nobody has
        started has no rows at all, and counting only what is present would let
        it pass as complete."""
        with tenant_context(self.tenant.id):
            self.mark(self.students[0], theory_marks=Decimal("60.00"))

        with self.assertRaises(Conflict) as caught:
            self.process()

        self.assertIn("still outstanding", str(caught.exception.detail))
        self.assertIn(self.subject.name, str(caught.exception.detail))

    def test_a_draft_row_does_not_count_as_entered(self) -> None:
        """A `draft` row was saved but never claimed as finished. Processing it
        would grade a student on a half-entered grid — which is why
        `:lock-marks` stamps rows as well as closing the window."""
        with tenant_context(self.tenant.id):
            for student in self.students:
                self.mark(student, theory_marks=Decimal("60.00"), status=MarksStatus.DRAFT)

        with self.assertRaises(Conflict):
            self.process()

    def test_an_exam_with_no_subjects_is_refused(self) -> None:
        with tenant_context(self.tenant.id):
            empty = ExamFactory(
                tenant=self.tenant,
                academic_session=self.session,
                grading_scale=self.scale,
                status=ExamStatus.MARKS_ENTRY,
            )

        with (
            tenant_context(self.tenant.id),
            self.assertRaises(Conflict) as caught,
        ):
            services.process_exam_results(exam=empty, actor_id=self.user.pk)

        self.assertIn("no subjects configured", str(caught.exception.detail))

    def test_a_complete_grid_processes(self) -> None:
        self.mark_all("60.00", "70.00", "80.00")

        outcome = self.process()

        self.assertEqual(outcome["students"], 3)
        self.assertEqual(outcome["created"], 3)


class ComputationTests(ProcessingTestCase):
    def test_a_percentage_and_grade_come_from_the_exam_s_own_scale(self) -> None:
        self.mark_all("60.00", "70.00", "85.00")

        self.process()

        rows = self.results()
        self.assertEqual(rows[self.students[2].pk].percentage, Decimal("85.00"))
        self.assertEqual(rows[self.students[2].pk].grade_band.label, "A")
        self.assertEqual(rows[self.students[0].pk].grade_band.label, "C")

    def test_a_gpa_scale_yields_grade_points(self) -> None:
        self.mark_all("85.00", "75.00", "65.00")

        self.process()

        self.assertEqual(self.results()[self.students[0].pk].gpa, Decimal("4.00"))

    def test_an_absent_student_is_absent_not_a_zero_percent_fail(self) -> None:
        """A zero would put them bottom of the rank and count against the
        section's pass rate — a data error presented as a child's result."""
        with tenant_context(self.tenant.id):
            self.mark(self.students[0], is_absent=True)
            self.mark(self.students[1], theory_marks=Decimal("70.00"))
            self.mark(self.students[2], theory_marks=Decimal("80.00"))

        self.process()

        row = self.results()[self.students[0].pk]
        self.assertEqual(row.outcome, ResultOutcome.ABSENT)
        self.assertIsNone(row.rank_in_section)

    def test_an_exempt_subject_shrinks_the_denominator(self) -> None:
        """§5.4 — "excluded from aggregates". Neither side of the fraction
        moves, which is what makes an exemption different from a zero."""
        second = self.second_subject()
        with tenant_context(self.tenant.id):
            for student in self.students:
                self.mark(student, theory_marks=Decimal("60.00"))
                MarksFactory(
                    tenant=self.tenant,
                    exam_subject=second,
                    student=student,
                    entered_by=self.user.pk,
                    status=MarksStatus.SUBMITTED,
                    is_exempt=True,
                )

        self.process()

        row = self.results()[self.students[0].pk]
        # Out of 100, not 200: the exempt subject contributed neither marks nor
        # maximum.
        self.assertEqual(row.total_max_marks, Decimal("100.00"))
        self.assertEqual(row.percentage, Decimal("60.00"))

    def test_an_absent_subject_keeps_its_maximum(self) -> None:
        """The contrast with exempt: the paper was set and not sat, so it
        counts against the student — which is what makes the two different
        claims rather than synonyms."""
        second = self.second_subject()
        with tenant_context(self.tenant.id):
            for student in self.students:
                self.mark(student, theory_marks=Decimal("60.00"))
                MarksFactory(
                    tenant=self.tenant,
                    exam_subject=second,
                    student=student,
                    entered_by=self.user.pk,
                    status=MarksStatus.SUBMITTED,
                    is_absent=True,
                )

        self.process()

        row = self.results()[self.students[0].pk]
        self.assertEqual(row.total_max_marks, Decimal("200.00"))
        self.assertEqual(row.percentage, Decimal("30.00"))

    def test_subject_weightage_shifts_the_aggregate(self) -> None:
        """§5.1 makes the weight apply within the exam's aggregate, so both
        sides of the fraction scale — scaling only the obtained side would
        silently change what the total was out of."""
        self.second_subject(subject_weightage_percent=Decimal("50.00"))
        with tenant_context(self.tenant.id):
            second = self.exam.exam_subjects.exclude(pk=self.exam_subject.pk).first()
            for student in self.students:
                self.mark(student, theory_marks=Decimal("60.00"))
                MarksFactory(
                    tenant=self.tenant,
                    exam_subject=second,
                    student=student,
                    entered_by=self.user.pk,
                    status=MarksStatus.SUBMITTED,
                    theory_marks=Decimal("80.00"),
                )

        self.process()

        row = self.results()[self.students[0].pk]
        # 100 at full weight + 100 at half = 150 maximum; 60 + 40 = 100 obtained.
        self.assertEqual(row.total_max_marks, Decimal("150.00"))
        self.assertEqual(row.total_obtained_marks, Decimal("100.00"))

    def test_failing_one_subject_fails_the_result(self) -> None:
        second = self.second_subject()
        with tenant_context(self.tenant.id):
            for student in self.students:
                self.mark(student, theory_marks=Decimal("90.00"))
                MarksFactory(
                    tenant=self.tenant,
                    exam_subject=second,
                    student=student,
                    entered_by=self.user.pk,
                    status=MarksStatus.SUBMITTED,
                    theory_marks=Decimal("10.00"),
                )

        self.process()

        row = self.results()[self.students[0].pk]
        # 50% overall is a passing band, but one subject is below its pass mark.
        self.assertEqual(row.outcome, ResultOutcome.FAIL)

    def test_ranks_are_dense_and_ties_share_a_rank(self) -> None:
        """Two students on 91% are both second and the next is third. Breaking
        the tie by name or id would invent a difference the marks do not
        support, and a school publishing that has to defend it."""
        self.mark_all("91.00", "91.00", "95.00")

        self.process()

        rows = self.results()
        self.assertEqual(rows[self.students[2].pk].rank_in_section, 1)
        self.assertEqual(rows[self.students[0].pk].rank_in_section, 2)
        self.assertEqual(rows[self.students[1].pk].rank_in_section, 2)

    def test_the_result_records_the_section_at_processing_time(self) -> None:
        self.mark_all("60.00", "70.00", "80.00")

        self.process()

        self.assertEqual(self.results()[self.students[0].pk].section_id, self.section.pk)

    def test_processing_a_whole_cohort_is_a_bounded_number_of_queries(self) -> None:
        """The reason `processing.collect` exists. The obvious implementation —
        for each student, fetch their marks and look up a band — is two round
        trips per child, and this runs over a whole school at once."""
        self.mark_all("60.00", "70.00", "80.00")

        with tenant_context(self.tenant.id), CaptureQueriesContext(connection) as captured:
            scope = processing.collect(exam=self.exam)
            processing.compute(scope)

        self.assertLessEqual(len(captured.captured_queries), 5)


class RecomputeTests(ProcessingTestCase):
    def test_recompute_updates_in_place(self) -> None:
        """§6 — "recompute is idempotent and re-runnable until approval"."""
        self.mark_all("60.00", "70.00", "80.00")
        self.process()

        with tenant_context(self.tenant.id):
            row = self.exam_subject.marks.get(student=self.students[0])
            row.theory_marks = Decimal("90.00")
            row.save(update_fields=["theory_marks"])
        second = self.process()

        self.assertEqual(second["created"], 0)
        self.assertEqual(second["updated"], 3)
        self.assertEqual(self.results()[self.students[0].pk].percentage, Decimal("90.00"))

    def test_recompute_after_approval_is_refused(self) -> None:
        """A recompute then would change a figure a principal has signed off,
        and the approval record would still name them."""
        self.mark_all("60.00", "70.00", "80.00")
        self.process()
        self._approve()

        with self.assertRaises(Conflict) as caught:
            self.process()

        self.assertIn("send them back for correction", str(caught.exception.detail))

    def test_a_withheld_result_stays_withheld_through_a_recompute(self) -> None:
        """§5.6 makes withholding a decision someone took. Returning it to
        pass/fail because the numbers were recalculated would reverse that
        decision without anyone asking."""
        self.mark_all("60.00", "70.00", "80.00")
        self.process()
        with tenant_context(self.tenant.id):
            row = Result.objects.alive().get(exam=self.exam, student=self.students[0])
            services.withhold_result(result=row, reason="Fees", actor_id=self.user.pk)

        self.process()

        self.assertEqual(self.results()[self.students[0].pk].outcome, ResultOutcome.WITHHELD)

    def _approve(self):
        with tenant_context(self.tenant.id):
            approver = UserFactory(tenant=self.tenant)
        grant(approver, "exams.result.approve", scope=RecordScope.ALL)
        with tenant_context(self.tenant.id):
            return services.approve_exam_results(exam=self.exam, approver_id=approver.pk)


class ApprovalTests(ProcessingTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.mark_all("60.00", "70.00", "80.00")
        self.process()

    def test_the_processor_cannot_approve_their_own_run(self) -> None:
        """§4's closing line, auth-and-rbac §2.4. The one rule here that exists
        purely to stop one person completing a two-person process."""
        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation) as caught:
            services.approve_exam_results(exam=self.exam, approver_id=self.user.pk)

        self.assertIn("second pair of eyes", str(caught.exception.detail))

    def test_a_different_user_may_approve(self) -> None:
        with tenant_context(self.tenant.id):
            approver = UserFactory(tenant=self.tenant)

        with tenant_context(self.tenant.id):
            outcome = services.approve_exam_results(exam=self.exam, approver_id=approver.pk)

        self.assertEqual(outcome["approved"], 3)
        with tenant_context(self.tenant.id):
            self.exam.refresh_from_db()
        self.assertEqual(self.exam.status, ExamStatus.APPROVED)
        row = self.results()[self.students[0].pk]
        self.assertEqual(row.status, ResultStatus.APPROVED)
        self.assertEqual(row.approved_by, approver.pk)
        self.assertIsNotNone(row.approved_at)

    def test_approving_an_unprocessed_exam_is_refused(self) -> None:
        with tenant_context(self.tenant.id):
            fresh = ExamFactory(
                tenant=self.tenant,
                academic_session=self.session,
                grading_scale=self.scale,
            )

        with tenant_context(self.tenant.id), self.assertRaises(Conflict):
            services.approve_exam_results(exam=fresh, approver_id=self.user.pk)

    def test_sending_results_back_reopens_marks_entry(self) -> None:
        """§7.1's "changes requested" edge, and the reason the recompute and
        entry gates can be strict: without it, an error found at approval has
        no route back and someone reaches for a database edit."""
        with tenant_context(self.tenant.id):
            outcome = services.send_results_back(
                exam=self.exam, actor_id=self.user.pk, reason="Section B mis-keyed"
            )
            self.exam.refresh_from_db()

        self.assertEqual(outcome["reopened"], 3)
        self.assertEqual(self.exam.status, ExamStatus.MARKS_ENTRY)
        row = self.results()[self.students[0].pk]
        self.assertEqual(row.status, ResultStatus.PROCESSING)
        self.assertIsNone(row.approved_by)


class PublishingTests(ProcessingTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.mark_all("60.00", "70.00", "80.00")
        self.process()
        with tenant_context(self.tenant.id):
            self.approver = UserFactory(tenant=self.tenant)
            services.approve_exam_results(exam=self.exam, approver_id=self.approver.pk)

    def test_publishing_releases_every_approved_result(self) -> None:
        with tenant_context(self.tenant.id):
            outcome = services.publish_exam_results(exam=self.exam, actor_id=self.approver.pk)
            self.exam.refresh_from_db()

        self.assertEqual(outcome["published"], 3)
        self.assertEqual(self.exam.status, ExamStatus.PUBLISHED)
        row = self.results()[self.students[0].pk]
        self.assertEqual(row.status, ResultStatus.PUBLISHED)
        self.assertIsNotNone(row.published_at)

    def test_publishing_an_unapproved_exam_is_refused(self) -> None:
        with tenant_context(self.tenant.id):
            fresh = ExamFactory(
                tenant=self.tenant,
                academic_session=self.session,
                grading_scale=self.scale,
                status=ExamStatus.PROCESSING,
            )

        with tenant_context(self.tenant.id), self.assertRaises(Conflict):
            services.publish_exam_results(exam=fresh, actor_id=self.user.pk)

    def test_a_withheld_result_is_not_published_with_its_section(self) -> None:
        """§5.6 — "withheld results supported per student"."""
        with tenant_context(self.tenant.id):
            row = Result.objects.alive().get(exam=self.exam, student=self.students[0])
            services.withhold_result(result=row, reason="Fees", actor_id=self.user.pk)
            outcome = services.publish_exam_results(exam=self.exam, actor_id=self.approver.pk)
            row.refresh_from_db()

        self.assertEqual(outcome["published"], 2)
        self.assertEqual(outcome["withheld"], 1)
        self.assertNotEqual(row.status, ResultStatus.PUBLISHED)

    def test_publishing_twice_moves_nothing_the_second_time(self) -> None:
        """The count is what §12's notification fires on, so it has to be the
        rows that *transitioned* — alerting on current status is the bug
        attendance's review found, where a retry re-sent every guardian the same
        message."""
        with tenant_context(self.tenant.id):
            services.publish_exam_results(exam=self.exam, actor_id=self.approver.pk)
            second = services.publish_exam_results(exam=self.exam, actor_id=self.approver.pk)

        self.assertEqual(second["published"], 0)

    def test_withholding_a_published_result_is_refused(self) -> None:
        """The result is already with the student; the remedy then is a
        correction, not a retroactive hold."""
        with tenant_context(self.tenant.id):
            services.publish_exam_results(exam=self.exam, actor_id=self.approver.pk)
            row = Result.objects.alive().get(exam=self.exam, student=self.students[0])

            with self.assertRaises(Conflict):
                services.withhold_result(result=row, reason="Too late", actor_id=self.user.pk)


class ResultVisibilityTests(ProcessingTestCase):
    """§5.6's two narrowings: whose result, and whether it is released yet."""

    def setUp(self) -> None:
        super().setUp()
        self.mark_all("60.00", "70.00", "80.00")
        self.process()
        with tenant_context(self.tenant.id):
            self.student_user = UserFactory(tenant=self.tenant)
            self.students[0].user_id = self.student_user.pk
            self.students[0].save(update_fields=["user_id"])
        grant(
            self.student_user,
            "exams.result.view",
            scope=RecordScope.OWN,
            is_restricted_principal=True,
        )
        self.portal = APIClient()
        authenticate(self.portal, self.student_user)

    def test_a_student_cannot_see_an_unpublished_result(self) -> None:
        """Record scope says the row is theirs; §5.6 says it is not released.
        Both have to be true, and only one of them is a question about
        ownership."""
        response = self.portal.get("/api/v1/results")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"], [])

    def test_a_student_sees_their_own_result_once_published(self) -> None:
        with tenant_context(self.tenant.id):
            approver = UserFactory(tenant=self.tenant)
            services.approve_exam_results(exam=self.exam, approver_id=approver.pk)
            services.publish_exam_results(exam=self.exam, actor_id=approver.pk)

        response = self.portal.get("/api/v1/results")

        rows = response.json()["data"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["student_id"], str(self.students[0].pk))

    def test_a_student_never_sees_another_student_s_published_result(self) -> None:
        with tenant_context(self.tenant.id):
            approver = UserFactory(tenant=self.tenant)
            services.approve_exam_results(exam=self.exam, approver_id=approver.pk)
            services.publish_exam_results(exam=self.exam, actor_id=approver.pk)
            other = Result.objects.alive().get(exam=self.exam, student=self.students[1])

        response = self.portal.get(f"/api/v1/results/{other.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_restricted_principal_cannot_process_or_publish(self) -> None:
        """PR B's review lesson: the readable actions are named and everything
        else is staff-only, so a portal role holding a write key is still
        refused."""
        grant(
            self.student_user,
            "exams.result.view",
            "exams.result.create",
            "exams.result.publish",
            scope=RecordScope.ALL,
            is_restricted_principal=True,
        )

        for action in ("process-results", "publish-results"):
            with self.subTest(action=action):
                response = self.portal.post(f"/api/v1/exams/{self.exam.pk}:{action}")
                self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
