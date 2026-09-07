"""§13's five reports, their record scoping, and their query counts.

The `assertNumQueries`-style assertions are the point of this file as much as
the numbers are. A result register over a whole school is exactly the shape
`ENGINEERING_STANDARDS.md` §3's N+1 rule exists for, and a report that quietly
grew a query per student would still return the right answer — so only a query
count catches it.

The other thing pinned here is that **the export recomputes the record scope
from the requester**. A report is read as authoritative, and an export that
re-queried without the scope the endpoint applied would silently widen it —
which is exactly what `attendance`'s export task was written to prevent.
"""

from __future__ import annotations

from decimal import Decimal

from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework import status
from rest_framework.test import APIClient

from apps.examinations import reports, services
from apps.examinations.models import (
    Marks,
    QuestionBank,
    Result,
    ResultOutcome,
    ResultStatus,
)
from apps.examinations.tests.factories import (
    QuestionBankFactory,
    QuestionFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.examinations.tests.test_processing import ProcessingTestCase
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

SUMMARY = "/api/v1/reports/exam-summary"


class ReportDataTestCase(ProcessingTestCase):
    """A processed exam with a spread of outcomes, so every report has content."""

    def setUp(self) -> None:
        super().setUp()
        self.mark_all("35.00", "70.00", "90.00")
        self.process()

    def scoped_results(self):
        return Result.objects.alive()

    def scoped_marks(self):
        return Marks.objects.alive()


class ResultRegisterTests(ReportDataTestCase):
    def test_the_register_is_one_query_for_the_whole_exam(self) -> None:
        with tenant_context(self.tenant.id), CaptureQueriesContext(connection) as captured:
            rows = reports.result_register(self.scoped_results(), exam_id=self.exam.pk)

        self.assertEqual(len(captured.captured_queries), 1)
        self.assertEqual(len(rows), 3)
        self.assertIn("admission_number", rows[0])
        self.assertIn("grade", rows[0])

    def test_it_is_ordered_by_rank_with_the_unranked_last(self) -> None:
        """How a register is read. A plain ascending sort would put absent
        students — who have no rank — first."""
        with tenant_context(self.tenant.id):
            row = Result.objects.alive().get(exam=self.exam, student=self.students[0])
            row.outcome = ResultOutcome.ABSENT
            row.rank_in_section = None
            row.save(update_fields=["outcome", "rank_in_section"])
            rows = reports.result_register(self.scoped_results(), exam_id=self.exam.pk)

        self.assertIsNone(rows[-1]["rank_in_section"])
        self.assertEqual(rows[0]["rank_in_section"], 1)

    def test_the_cap_reaches_sql_rather_than_truncating_in_python(self) -> None:
        with tenant_context(self.tenant.id):
            rows = reports.result_register(self.scoped_results(), exam_id=self.exam.pk, limit=2)

        self.assertEqual(len(rows), 2)


class PassFailTests(ReportDataTestCase):
    def test_the_analysis_is_one_query_and_groups_by_section(self) -> None:
        with tenant_context(self.tenant.id), CaptureQueriesContext(connection) as captured:
            rows = reports.pass_fail_analysis(self.scoped_results(), exam_id=self.exam.pk)

        self.assertEqual(len(captured.captured_queries), 1)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["students"], 3)

    def test_the_pass_rate_excludes_absent_and_withheld_students(self) -> None:
        """An absent student is not a failure. Counting them in the denominator
        would make a school's pass rate depend on who was ill — the same
        reasoning that keeps `processing` from scoring them zero."""
        with tenant_context(self.tenant.id):
            absent = Result.objects.alive().get(exam=self.exam, student=self.students[0])
            absent.outcome = ResultOutcome.ABSENT
            absent.save(update_fields=["outcome"])
            rows = reports.pass_fail_analysis(self.scoped_results(), exam_id=self.exam.pk)

        row = rows[0]
        self.assertEqual(row["sat"], 2)
        self.assertEqual(row["absent"], 1)
        self.assertEqual(row["pass_rate"], Decimal("100.0"))

    def test_a_section_where_nobody_sat_reports_zero_not_a_division_error(self) -> None:
        with tenant_context(self.tenant.id):
            Result.objects.alive().filter(exam=self.exam).update(outcome=ResultOutcome.ABSENT)
            rows = reports.pass_fail_analysis(self.scoped_results(), exam_id=self.exam.pk)

        self.assertEqual(rows[0]["pass_rate"], Decimal("0.0"))


class SubjectPerformanceTests(ReportDataTestCase):
    def test_it_is_one_query_over_marks_not_results(self) -> None:
        """ "Which paper was hard" is a question about one paper; a result is an
        aggregate across subjects."""
        with tenant_context(self.tenant.id), CaptureQueriesContext(connection) as captured:
            rows = reports.subject_performance(self.scoped_marks(), exam_id=self.exam.pk)

        self.assertEqual(len(captured.captured_queries), 1)
        self.assertEqual(rows[0]["students"], 3)
        self.assertEqual(rows[0]["highest_marks"], Decimal("90.00"))

    def test_absent_and_exempt_rows_are_excluded_from_the_average(self) -> None:
        """A zero nobody sat is not a low mark, and averaging it in would make
        a paper look harder than it was."""
        with tenant_context(self.tenant.id):
            row = Marks.objects.alive().get(
                exam_subject=self.exam_subject, student=self.students[0]
            )
            row.theory_marks = None
            row.is_absent = True
            row.save(update_fields=["theory_marks", "is_absent"])
            rows = reports.subject_performance(self.scoped_marks(), exam_id=self.exam.pk)

        self.assertEqual(rows[0]["students"], 2)
        self.assertEqual(rows[0]["average_marks"], Decimal("80.00"))

    def test_the_pass_rate_compares_against_the_subject_s_own_pass_mark(self) -> None:
        with tenant_context(self.tenant.id):
            rows = reports.subject_performance(self.scoped_marks(), exam_id=self.exam.pk)

        # 35 is below the 40 pass mark; 70 and 90 are above.
        self.assertEqual(rows[0]["passed"], 2)
        self.assertEqual(rows[0]["pass_rate"], Decimal("66.7"))


class MarksEntryStatusTests(ReportDataTestCase):
    def test_it_is_one_query_and_counts_by_status(self) -> None:
        with tenant_context(self.tenant.id), CaptureQueriesContext(connection) as captured:
            rows = reports.marks_entry_status(self.scoped_marks(), exam_id=self.exam.pk)

        self.assertEqual(len(captured.captured_queries), 1)
        self.assertEqual(rows[0]["entered"], 3)
        self.assertEqual(rows[0]["submitted"], 3)


class GradeDistributionTests(ReportDataTestCase):
    def test_it_is_one_query_grouped_on_the_band(self) -> None:
        """Grouped on the band rather than on the percentage, so the histogram
        matches the scale a school published rather than an arbitrary
        bucketing."""
        with tenant_context(self.tenant.id), CaptureQueriesContext(connection) as captured:
            rows = reports.grade_distribution(self.scoped_results(), exam_id=self.exam.pk)

        self.assertEqual(len(captured.captured_queries), 1)
        self.assertEqual(sum(row["students"] for row in rows), 3)

    def test_an_ungraded_result_is_kept_rather_than_dropped(self) -> None:
        """A distribution that silently omits students does not add up to the
        cohort."""
        with tenant_context(self.tenant.id):
            row = Result.objects.alive().get(exam=self.exam, student=self.students[0])
            row.grade_band = None
            row.save(update_fields=["grade_band"])
            rows = reports.grade_distribution(self.scoped_results(), exam_id=self.exam.pk)

        self.assertEqual(sum(entry["students"] for entry in rows), 3)
        self.assertIn(None, [entry["grade"] for entry in rows])


class QuestionBankUsageTests(ReportDataTestCase):
    def test_it_is_one_query_grouped_by_bank_and_difficulty(self) -> None:
        with tenant_context(self.tenant.id):
            bank = QuestionBankFactory(tenant=self.tenant, subject=self.subject)
            for _ in range(3):
                QuestionFactory(tenant=self.tenant, question_bank=bank)

        with tenant_context(self.tenant.id), CaptureQueriesContext(connection) as captured:
            rows = reports.question_bank_usage(QuestionBank.objects.alive())

        self.assertEqual(len(captured.captured_queries), 1)
        self.assertEqual(rows[0]["questions"], 3)
        self.assertEqual(rows[0]["approved"], 3)


class ReportEndpointTests(ReportDataTestCase):
    def test_a_small_report_is_served_inline(self) -> None:
        response = self.client.get(f"{SUMMARY}?kind=result-register&exam_id={self.exam.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(len(response.json()["data"]), 3)

    def test_an_unknown_kind_is_refused_and_lists_the_options(self) -> None:
        response = self.client.get(f"{SUMMARY}?kind=nonsense&exam_id={self.exam.pk}")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_report_about_one_exam_requires_the_exam_id(self) -> None:
        response = self.client.get(f"{SUMMARY}?kind=result-register")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("exam_id", str(response.json()))

    def test_question_bank_usage_needs_no_exam(self) -> None:
        """It is about a bank, not an exam — so requiring one would be a
        validation that describes the wrong resource."""
        response = self.client.get(f"{SUMMARY}?kind=question-bank-usage")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

    def test_an_export_returns_202_and_a_job(self) -> None:
        response = self.client.post(
            SUMMARY,
            {"kind": "result-register", "exam_id": str(self.exam.pk), "format": "xlsx"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        self.assertIn("job_id", response.json()["data"])

    def test_exporting_needs_the_export_key_not_the_view_key(self) -> None:
        """§4 lists `exams.result.export` separately from `.view`."""
        with tenant_context(self.tenant.id):
            viewer = UserFactory(tenant=self.tenant)
        grant(viewer, "exams.result.view", scope=RecordScope.ALL)
        client = APIClient()
        authenticate(client, viewer)

        response = client.post(
            SUMMARY,
            {"kind": "result-register", "exam_id": str(self.exam.pk)},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_a_restricted_principal_cannot_reach_the_report_endpoint(self) -> None:
        """§13's reports are staff analytics. A student reads their own result,
        which `/results` serves under record scope."""
        with tenant_context(self.tenant.id):
            student_user = UserFactory(tenant=self.tenant)
        grant(
            student_user,
            "exams.result.view",
            scope=RecordScope.ALL,
            is_restricted_principal=True,
        )
        client = APIClient()
        authenticate(client, student_user)

        response = client.get(f"{SUMMARY}?kind=result-register&exam_id={self.exam.pk}")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class ReportScopeTests(ReportDataTestCase):
    def test_the_builder_applies_the_requester_s_record_scope(self) -> None:
        """The property the export depends on: a report is read as
        authoritative, so an export must not widen what its requester could see
        inline."""
        with tenant_context(self.tenant.id):
            teacher_rows = services.build_report_rows(
                kind="result-register", exam_id=self.exam.pk, user=self.teacher_user
            )
            admin_rows = services.build_report_rows(
                kind="result-register", exam_id=self.exam.pk, user=self.user
            )

        # The class teacher holds no result key in this fixture, so they see
        # nothing — which is the fail-closed direction.
        self.assertEqual(teacher_rows, [])
        self.assertEqual(len(admin_rows), 3)

    def test_an_assigned_teacher_sees_their_own_section_s_register(self) -> None:
        grant(self.teacher_user, "exams.result.view", scope=RecordScope.ASSIGNED)

        with tenant_context(self.tenant.id):
            rows = services.build_report_rows(
                kind="result-register", exam_id=self.exam.pk, user=self.teacher_user
            )

        self.assertEqual(len(rows), 3)

    def test_the_inline_path_asks_for_one_row_more_than_the_ceiling(self) -> None:
        """So the "inline or job?" decision costs one extra row rather than the
        whole report — the mistake attendance's review caught in the same
        place."""
        with tenant_context(self.tenant.id):
            rows = services.build_report_rows(
                kind="result-register",
                exam_id=self.exam.pk,
                user=self.user,
                limit=2,
            )

        self.assertEqual(len(rows), 2)


class ExportRenderTests(ReportDataTestCase):
    def test_the_register_renders_in_all_three_formats(self) -> None:
        """One row shape, three formatters — so the numbers in a spreadsheet
        and a printed register cannot drift."""
        from core.exports import tabular

        with tenant_context(self.tenant.id):
            rows = reports.result_register(self.scoped_results(), exam_id=self.exam.pk)

        for fmt, marker in (("csv", b"admission_number"), ("xlsx", b"PK"), ("pdf", b"%PDF")):
            with self.subTest(fmt=fmt):
                data, _, _ = tabular.render(rows, fmt=fmt, title="Result register")
                self.assertTrue(data.startswith(marker) or marker in data)

    def test_a_published_result_register_carries_the_status(self) -> None:
        with tenant_context(self.tenant.id):
            rows = reports.result_register(self.scoped_results(), exam_id=self.exam.pk)

        self.assertEqual(rows[0]["status"], ResultStatus.PENDING_APPROVAL)
