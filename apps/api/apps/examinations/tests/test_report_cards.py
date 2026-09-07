"""§5.7's report cards — the two disjoint uniques, versioning, and the snapshot.

Three things here are worth reading:

- **the two partial uniques coexist and are disjoint** on `exam_id IS NOT NULL`
  / `term_id IS NOT NULL`, the same shape `student_attendance` proved for its
  daily-versus-period split. One unique index over both columns would let a
  student collect two exam cards for one exam, because PostgreSQL treats NULLs
  as distinct;
- **the attendance summary is a snapshot**, not a live join. A card is a
  document a school hands to a parent; computed on read, last year's card would
  restate itself against this year's register every time anyone opened it;
- **regeneration bumps `version` and preserves remarks.** A regeneration
  triggered by a marks correction has nothing to say about a class teacher's
  words, and losing them would make anyone who had written remarks reluctant to
  regenerate at all.
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from django.db import IntegrityError, transaction
from rest_framework import status
from rest_framework.test import APIClient

from apps.examinations import documents, services
from apps.examinations.models import (
    ExamStatus,
    ReportCardStatus,
    Result,
    ResultStatus,
)
from apps.examinations.tests.factories import (
    ReportCardFactory,
    ResultFactory,
    TermFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.examinations.tests.test_processing import ProcessingTestCase
from core.api.exceptions import Conflict
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

REPORT_CARDS = "/api/v1/report-cards"


class ReportCardConstraintTests(ProcessingTestCase):
    def _result(self, student):
        return ResultFactory(
            tenant=self.tenant, exam=self.exam, student=student, section=self.section
        )

    def test_one_card_per_student_per_exam(self) -> None:
        with tenant_context(self.tenant.id):
            result = self._result(self.students[0])
            ReportCardFactory(
                tenant=self.tenant,
                exam=self.exam,
                student=self.students[0],
                result=result,
            )

        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(IntegrityError),
        ):
            ReportCardFactory(tenant=self.tenant, exam=self.exam, student=self.students[0])

    def test_an_exam_card_and_a_term_card_coexist(self) -> None:
        """The disjoint-partial-index property. One unique index over both
        columns would treat the NULLs as distinct and enforce neither half."""
        with tenant_context(self.tenant.id):
            ReportCardFactory(tenant=self.tenant, exam=self.exam, student=self.students[0])
            card = ReportCardFactory(tenant=self.tenant, term=self.term, student=self.students[0])

        self.assertIsNone(card.exam_id)
        self.assertEqual(card.term_id, self.term.pk)

    def test_a_card_with_neither_scope_is_refused(self) -> None:
        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(IntegrityError),
        ):
            ReportCardFactory(tenant=self.tenant, student=self.students[0])

    def test_a_card_with_both_scopes_is_refused(self) -> None:
        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(IntegrityError),
        ):
            ReportCardFactory(
                tenant=self.tenant,
                exam=self.exam,
                term=self.term,
                student=self.students[0],
            )

    def test_two_term_cards_for_one_student_are_refused(self) -> None:
        with tenant_context(self.tenant.id):
            ReportCardFactory(tenant=self.tenant, term=self.term, student=self.students[0])

        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(IntegrityError),
        ):
            ReportCardFactory(tenant=self.tenant, term=self.term, student=self.students[0])

    def test_a_second_term_gets_its_own_card(self) -> None:
        with tenant_context(self.tenant.id):
            other_term = TermFactory(tenant=self.tenant, academic_session=self.session, sequence=2)
            ReportCardFactory(tenant=self.tenant, term=self.term, student=self.students[0])
            card = ReportCardFactory(tenant=self.tenant, term=other_term, student=self.students[0])

        self.assertEqual(card.term_id, other_term.pk)


class PublishedResultsTestCase(ProcessingTestCase):
    """An exam with published results — the state cards generate from."""

    def setUp(self) -> None:
        super().setUp()
        self.mark_all("60.00", "70.00", "80.00")
        self.process()
        with tenant_context(self.tenant.id):
            self.approver = UserFactory(tenant=self.tenant)
            services.approve_exam_results(exam=self.exam, approver_id=self.approver.pk)
            services.publish_exam_results(exam=self.exam, actor_id=self.approver.pk)
            self.exam.refresh_from_db()


class GenerationGateTests(PublishedResultsTestCase):
    def test_cards_need_published_results(self) -> None:
        """§11 — a card carries a grade and a rank, so generating one before
        publication puts a figure in a parent's hands the school has not yet
        released."""
        with tenant_context(self.tenant.id):
            unpublished = self.exam
            unpublished.status = ExamStatus.APPROVED
            unpublished.save(update_fields=["status"])

            with self.assertRaises(Conflict) as caught:
                services.assert_report_cards_are_generatable(unpublished)

        self.assertIn("published results", str(caught.exception.detail))

    def test_generation_returns_202_and_a_job(self) -> None:
        response = self.client.post(f"/api/v1/exams/{self.exam.pk}:generate-report-cards")

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        self.assertIn("job_id", response.json()["data"])

    def test_generation_needs_the_create_key(self) -> None:
        with tenant_context(self.tenant.id):
            viewer = UserFactory(tenant=self.tenant)
        grant(viewer, "exams.report-card.view", scope=RecordScope.ALL)
        client = APIClient()
        authenticate(client, viewer)

        response = client.post(f"/api/v1/exams/{self.exam.pk}:generate-report-cards")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class UpsertAndVersionTests(PublishedResultsTestCase):
    def _upsert(self, summary=None):
        with tenant_context(self.tenant.id):
            result = Result.objects.alive().get(exam=self.exam, student=self.students[0])
            return services.upsert_report_card(
                exam=self.exam, result=result, summary=summary, actor_id=self.user.pk
            )

    def test_a_first_generation_creates_a_draft_at_version_one(self) -> None:
        card = self._upsert()

        self.assertEqual(card.version, 1)
        self.assertEqual(card.status, ReportCardStatus.DRAFT)

    def test_regenerating_a_draft_does_not_bump_the_version(self) -> None:
        """A draft nobody has seen is not a new issue of anything."""
        self._upsert()

        card = self._upsert()

        self.assertEqual(card.version, 1)

    def test_regenerating_a_published_card_bumps_the_version(self) -> None:
        """§6's "regeneration versioning" — the previous card stops being
        current without the record of it vanishing."""
        card = self._upsert()
        with tenant_context(self.tenant.id):
            card.status = ReportCardStatus.PUBLISHED
            card.save(update_fields=["status"])

        regenerated = self._upsert()

        self.assertEqual(regenerated.version, 2)
        self.assertEqual(regenerated.status, ReportCardStatus.DRAFT)

    def test_regeneration_preserves_remarks(self) -> None:
        """A regeneration triggered by a marks correction has nothing to say
        about a class teacher's words, and losing them would make anyone who
        had written remarks reluctant to regenerate."""
        card = self._upsert()
        with tenant_context(self.tenant.id):
            card.class_teacher_remarks = "A thoughtful term's work."
            card.status = ReportCardStatus.PUBLISHED
            card.save(update_fields=["class_teacher_remarks", "status"])

        regenerated = self._upsert()

        self.assertEqual(regenerated.class_teacher_remarks, "A thoughtful term's work.")

    def test_regeneration_clears_the_stale_file(self) -> None:
        """The old PDF describes the old numbers. Leaving it linked would serve
        a document that contradicts the row it hangs off."""
        card = self._upsert()
        with tenant_context(self.tenant.id):
            card.file = self._a_file()
            card.status = ReportCardStatus.GENERATED
            card.save(update_fields=["file", "status"])

        regenerated = self._upsert()

        self.assertIsNone(regenerated.file_id)

    def _a_file(self):
        from apps.examinations import uploads
        from core.files.services import create_ready_file

        return create_ready_file(
            tenant_id=self.tenant.pk,
            purpose=uploads.REPORT_CARD.key,
            original_name="stub.pdf",
            mime_type="application/pdf",
            data=b"%PDF-stub",
            actor_id=self.user.pk,
        )


class AttendanceSnapshotTests(PublishedResultsTestCase):
    def test_the_summary_comes_from_the_attendance_module(self) -> None:
        """The same query §13's own attendance report uses, so a report card and
        an attendance report cannot disagree about the same child."""
        from apps.attendance.models import AttendanceStatus
        from apps.attendance.tests.factories import StudentAttendanceFactory

        start, end = services.report_card_period(exam=self.exam)
        with tenant_context(self.tenant.id):
            for offset in range(4):
                StudentAttendanceFactory(
                    tenant=self.tenant,
                    student=self.students[0],
                    section=self.section,
                    academic_session=self.session,
                    attendance_date=start + datetime.timedelta(days=offset),
                    status=(AttendanceStatus.ABSENT if offset == 3 else AttendanceStatus.PRESENT),
                    marked_by=self.user.pk,
                )
            summaries = services.attendance_summary_for(
                students=list(self.students), start_date=start, end_date=end
            )

        summary = summaries[self.students[0].pk]
        self.assertEqual(summary["counted_days"], 4)
        self.assertEqual(summary["present_days"], 3)
        self.assertEqual(summary["attendance_rate"], "75.0")

    def test_a_student_with_no_register_rows_is_absent_from_the_mapping(self) -> None:
        """Not present with zeros: a school that has not kept attendance has no
        figure, and printing 0% attended would be a claim the data does not
        support."""
        start, end = services.report_card_period(exam=self.exam)
        with tenant_context(self.tenant.id):
            summaries = services.attendance_summary_for(
                students=list(self.students), start_date=start, end_date=end
            )

        self.assertEqual(summaries, {})

    def test_the_period_is_the_term_where_there_is_one(self) -> None:
        """A parent reading a card expects the term's figure, not the three days
        of an exam week."""
        with tenant_context(self.tenant.id):
            self.exam.term = self.term
            self.exam.save(update_fields=["term"])
            start, end = services.report_card_period(exam=self.exam)

        self.assertEqual((start, end), (self.term.start_date, self.term.end_date))

    def test_the_summary_is_one_query_for_the_whole_cohort(self) -> None:
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        start, end = services.report_card_period(exam=self.exam)
        with tenant_context(self.tenant.id), CaptureQueriesContext(connection) as captured:
            services.attendance_summary_for(
                students=list(self.students), start_date=start, end_date=end
            )

        self.assertEqual(len(captured.captured_queries), 1)


class ReportCardDocumentTests(PublishedResultsTestCase):
    def _card_and_result(self):
        with tenant_context(self.tenant.id):
            result = Result.objects.alive().get(exam=self.exam, student=self.students[0])
            card = services.upsert_report_card(
                exam=self.exam,
                result=result,
                summary={
                    "present_days": 3,
                    "counted_days": 4,
                    "absent_days": 1,
                    "late_days": 0,
                    "attendance_rate": "75.0",
                },
                actor_id=self.user.pk,
            )
        return card, result

    def _rows(self):
        return [
            {
                "subject": self.subject.name,
                "max_marks": Decimal("100.00"),
                "obtained": Decimal("60.00"),
                "is_absent": False,
                "is_exempt": False,
                "verdict": "Pass",
            }
        ]

    def test_a_card_carries_the_totals_grade_rank_and_attendance(self) -> None:
        card, result = self._card_and_result()

        html = documents.report_card_html(
            card=card,
            exam=self.exam,
            student=self.students[0],
            result=result,
            subject_rows=self._rows(),
            school_name="Test School",
        )

        self.assertIn(self.subject.name, html)
        self.assertIn("60.00", html)
        self.assertIn(result.grade_band.label, html)
        self.assertIn("75.0", html)

    def test_an_absent_subject_prints_absent_not_a_zero(self) -> None:
        """A zero on a report card reads as a mark the student earned."""
        card, result = self._card_and_result()
        rows = self._rows()
        rows[0].update({"is_absent": True, "obtained": Decimal("0.00")})

        html = documents.report_card_html(
            card=card,
            exam=self.exam,
            student=self.students[0],
            result=result,
            subject_rows=rows,
            school_name="Test School",
        )

        self.assertIn("Absent", html)

    def test_an_empty_remarks_box_is_not_printed(self) -> None:
        """An empty "Class teacher's remarks" box on a document a parent keeps
        is worse than no box at all."""
        card, result = self._card_and_result()

        html = documents.report_card_html(
            card=card,
            exam=self.exam,
            student=self.students[0],
            result=result,
            subject_rows=self._rows(),
            school_name="Test School",
        )

        self.assertNotIn("Class teacher&#x27;s remarks", html)

    def test_a_remark_containing_markup_is_escaped(self) -> None:
        card, result = self._card_and_result()
        with tenant_context(self.tenant.id):
            card.class_teacher_remarks = "<b>Excellent</b> & improving"
            card.save(update_fields=["class_teacher_remarks"])

        html = documents.report_card_html(
            card=card,
            exam=self.exam,
            student=self.students[0],
            result=result,
            subject_rows=self._rows(),
            school_name="Test School",
        )

        self.assertNotIn("<b>Excellent</b>", html)
        self.assertIn("&lt;b&gt;Excellent&lt;/b&gt; &amp; improving", html)

    def test_a_card_with_no_attendance_says_not_recorded(self) -> None:
        with tenant_context(self.tenant.id):
            result = Result.objects.alive().get(exam=self.exam, student=self.students[0])
            card = services.upsert_report_card(
                exam=self.exam, result=result, summary=None, actor_id=self.user.pk
            )

        html = documents.report_card_html(
            card=card,
            exam=self.exam,
            student=self.students[0],
            result=result,
            subject_rows=self._rows(),
            school_name="Test School",
        )

        self.assertIn("Not recorded", html)


class RemarkAndPublishTests(PublishedResultsTestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            result = Result.objects.alive().get(exam=self.exam, student=self.students[0])
            self.card = services.upsert_report_card(
                exam=self.exam, result=result, summary=None, actor_id=self.user.pk
            )

    def test_remarks_are_patchable_on_a_draft(self) -> None:
        response = self.client.patch(
            f"{REPORT_CARDS}/{self.card.pk}",
            {"class_teacher_remarks": "Steady progress."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            self.card.refresh_from_db()
        self.assertEqual(self.card.class_teacher_remarks, "Steady progress.")

    def test_remarks_cannot_be_patched_on_a_published_card(self) -> None:
        """Editing them would change a document a parent already holds without
        the version changing."""
        with tenant_context(self.tenant.id):
            self.card.status = ReportCardStatus.PUBLISHED
            self.card.save(update_fields=["status"])

        response = self.client.patch(
            f"{REPORT_CARDS}/{self.card.pk}",
            {"class_teacher_remarks": "Rewritten."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_publishing_needs_a_rendered_file(self) -> None:
        """A draft with no document would put a link in a parent's portal that
        resolves to nothing."""
        response = self.client.post(f"/api/v1/exams/{self.exam.pk}:publish-report-cards")

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("finished rendering", str(response.json()))

    def test_a_generated_card_publishes(self) -> None:
        with tenant_context(self.tenant.id):
            from apps.examinations import uploads
            from core.files.services import create_ready_file

            self.card.file = create_ready_file(
                tenant_id=self.tenant.pk,
                purpose=uploads.REPORT_CARD.key,
                original_name="stub.pdf",
                mime_type="application/pdf",
                data=b"%PDF-stub",
                actor_id=self.user.pk,
            )
            self.card.status = ReportCardStatus.GENERATED
            self.card.save(update_fields=["file", "status"])

        response = self.client.post(f"/api/v1/exams/{self.exam.pk}:publish-report-cards")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            self.card.refresh_from_db()
        self.assertEqual(self.card.status, ReportCardStatus.PUBLISHED)
        self.assertIsNotNone(self.card.published_at)


class ReportCardVisibilityTests(PublishedResultsTestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            result = Result.objects.alive().get(exam=self.exam, student=self.students[0])
            self.card = services.upsert_report_card(
                exam=self.exam, result=result, summary=None, actor_id=self.user.pk
            )
            self.student_user = UserFactory(tenant=self.tenant)
            self.students[0].user_id = self.student_user.pk
            self.students[0].save(update_fields=["user_id"])
        grant(
            self.student_user,
            "exams.report-card.view",
            scope=RecordScope.OWN,
            is_restricted_principal=True,
        )
        self.portal = APIClient()
        authenticate(self.portal, self.student_user)

    def test_a_student_cannot_see_a_draft_card(self) -> None:
        response = self.portal.get(REPORT_CARDS)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"], [])

    def test_a_student_sees_their_card_once_published(self) -> None:
        with tenant_context(self.tenant.id):
            self.card.status = ReportCardStatus.PUBLISHED
            self.card.save(update_fields=["status"])

        response = self.portal.get(REPORT_CARDS)

        rows = response.json()["data"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], str(self.card.pk))

    def test_a_restricted_principal_cannot_patch_remarks(self) -> None:
        grant(
            self.student_user,
            "exams.report-card.view",
            "exams.report-card.create",
            scope=RecordScope.ALL,
            is_restricted_principal=True,
        )

        response = self.portal.patch(
            f"{REPORT_CARDS}/{self.card.pk}",
            {"class_teacher_remarks": "Mine now."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_there_is_no_report_card_create_endpoint(self) -> None:
        response = self.client.post(REPORT_CARDS, {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)


class ResultStatusSanityTests(PublishedResultsTestCase):
    def test_every_published_result_carries_a_timestamp(self) -> None:
        """The CHECK behind it: a published result with no `published_at` is an
        audit trail with a hole in it, and this is the row a school points at
        when a parent disputes a grade."""
        with tenant_context(self.tenant.id):
            rows = list(Result.objects.alive().filter(exam=self.exam))

        for row in rows:
            with self.subTest(student=row.student_id):
                self.assertEqual(row.status, ResultStatus.PUBLISHED)
                self.assertIsNotNone(row.published_at)
                self.assertIsNotNone(row.approved_by)
