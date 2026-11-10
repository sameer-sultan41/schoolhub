"""A paper's total marks when a section overrides each question's marks.

Its own file so the fix (the job payload's string `marks_each` read back as a
Decimal before it is summed) and its test commit together.
"""

from __future__ import annotations

from unittest import mock

from rest_framework import status

from apps.examinations import tasks
from apps.examinations.models import QuestionDifficulty
from apps.examinations.tests.test_question_banks import BANKS, QuestionBankTestCase
from core.jobs.models import BackgroundJob, JobStatus
from core.tenancy.context import tenant_context


def assemble_inline(case: QuestionBankTestCase, section: dict) -> BackgroundJob:
    """Post a one-section blueprint, then run its job inline with the PDF render stubbed."""
    blueprint = {"title": "Term 1 Paper", "sections": [section]}
    with mock.patch("core.documents.render_pdf", return_value=b"%PDF-stub"):
        response = case.client.post(
            f"{BANKS}/{case.bank.pk}:assemble-paper", blueprint, format="json"
        )
        case.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        data = response.json()["data"]
        case.assertEqual(set(data), {"job_id", "status"})
        tasks.assemble_paper_task(
            tenant_id=str(case.tenant.pk), job_id=data["job_id"], actor_id=str(case.user.pk)
        )
    with tenant_context(case.tenant.id):
        return BackgroundJob.objects.get(pk=data["job_id"])


class PaperMarksOverrideTests(QuestionBankTestCase):
    def test_a_section_marks_override_is_summed_as_a_decimal(self) -> None:
        """The payload carries `marks_each` as a string; summing it as one failed the job."""
        self.stock(easy=3)

        job = assemble_inline(
            self, {"difficulty": QuestionDifficulty.EASY, "count": 2, "marks_each": "5.00"}
        )

        self.assertEqual(job.status, JobStatus.SUCCEEDED, job.error)
        self.assertEqual(job.result["total_marks"], "10.00")
