"""A paper job that fails on a mid-job shortfall stores the plain sentence.

`select_paper_questions` raises `DomainRuleViolation({"sections": ...})` when the
pool shrank between the endpoint's check and the job; the job's `error` is what
the dashboard toasts, so it must be the sentence, not the field dict's repr.
"""

from __future__ import annotations

from apps.examinations import tasks
from apps.examinations.models import QuestionDifficulty
from apps.examinations.tests.test_question_banks import QuestionBankTestCase
from core.jobs.models import JobStatus
from core.jobs.services import create_job
from core.tenancy.context import tenant_context


class PaperJobErrorTests(QuestionBankTestCase):
    def test_a_mid_job_shortfall_is_stored_as_its_plain_sentence(self) -> None:
        self.stock(easy=1)
        with tenant_context(self.tenant.id):
            job = create_job(
                tenant_id=self.tenant.pk,
                job_type="exams.assemble-paper",
                payload={
                    "question_bank_id": str(self.bank.pk),
                    "title": "Term 1 Paper",
                    "sections": [
                        {"difficulty": QuestionDifficulty.EASY, "count": 5, "marks_each": None}
                    ],
                    "requested_by": str(self.user.pk),
                },
                actor_id=self.user.pk,
            )

        tasks.assemble_paper_task(
            tenant_id=str(self.tenant.pk), job_id=str(job.pk), actor_id=str(self.user.pk)
        )

        with tenant_context(self.tenant.id):
            job.refresh_from_db()
        self.assertEqual(job.status, JobStatus.FAILED)
        self.assertEqual(
            job.error,
            "Section 1 asked for 5 easy question(s) but only 1 approved question(s) were "
            "available when the paper was assembled. The bank changed after the blueprint was "
            "accepted — re-check it and try again.",
        )
