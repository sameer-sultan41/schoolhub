"""§4's segregation of duties against the *latest* processing run.

After a send-back and a re-process by someone else, the gate follows the new
processor: they may not approve, and the original processor, who no longer owns
the figures, may. How the latest processor is recorded is
`test_results_processed_by.py`'s subject.
"""

from __future__ import annotations

from rest_framework import status
from rest_framework.test import APIClient

from apps.examinations import services
from apps.examinations.models import ExamStatus, Result, ResultStatus
from apps.examinations.tests.factories import UserFactory, authenticate, grant
from apps.examinations.tests.test_processing import ProcessingTestCase
from core.api.exceptions import DomainRuleViolation
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context


class ReprocessTestCase(ProcessingTestCase):
    """A complete grid processed by A, and three users to act on it."""

    def setUp(self) -> None:
        super().setUp()
        self.mark_all("60.00", "70.00", "80.00")
        with tenant_context(self.tenant.id):
            self.a = UserFactory(tenant=self.tenant)
            self.b = UserFactory(tenant=self.tenant)
            self.c = UserFactory(tenant=self.tenant)
            services.process_exam_results(exam=self.exam, actor_id=self.a.pk)

    def send_back_and_reprocess(self) -> None:
        """A processes (setUp), B sends back, C re-processes."""
        with tenant_context(self.tenant.id):
            services.send_results_back(exam=self.exam, actor_id=self.b.pk, reason="Re-key B")
            services.process_exam_results(exam=self.exam, actor_id=self.c.pk)


class ProcessorStampTests(ReprocessTestCase):
    def test_the_original_processor_may_approve_after_a_re_process_by_someone_else(self) -> None:
        """A processes, B sends back, C re-processes: C is refused and A approves.
        Compared against `created_by`, the gate refused A and let C approve their
        own figures."""
        self.send_back_and_reprocess()

        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation) as caught:
            services.approve_exam_results(exam=self.exam, approver_id=self.c.pk)
        self.assertIn("approved_by", caught.exception.detail)

        with tenant_context(self.tenant.id):
            outcome = services.approve_exam_results(exam=self.exam, approver_id=self.a.pk)
            self.exam.refresh_from_db()

        self.assertEqual(outcome, {"approved": 3})
        self.assertEqual(self.exam.status, ExamStatus.APPROVED)
        with tenant_context(self.tenant.id):
            approvers = set(
                Result.objects.alive().filter(exam=self.exam).values_list("approved_by", flat=True)
            )
        self.assertEqual(approvers, {self.a.pk})

    def test_a_forced_approval_by_the_processor_is_a_422_over_http(self) -> None:
        """The dashboard disables Approve for the processor; a forced request
        still gets the server's refusal."""
        grant(self.a, "exams.result.view", "exams.result.approve", scope=RecordScope.ALL)
        client = APIClient()
        authenticate(client, self.a)

        response = client.post(f"/api/v1/exams/{self.exam.pk}:approve-results")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        error = response.json()["error"]
        self.assertEqual(error["code"], "domain_rule_violation")
        self.assertEqual(error["details"][0]["field"], "approved_by")
        with tenant_context(self.tenant.id):
            statuses = set(
                Result.objects.alive().filter(exam=self.exam).values_list("status", flat=True)
            )
        self.assertEqual(statuses, {ResultStatus.PENDING_APPROVAL})
