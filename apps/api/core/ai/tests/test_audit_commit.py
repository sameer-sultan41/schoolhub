"""The audit row is committed before the error leaves `run_feature`.

TransactionTestCase, not TestCase: under TestCase every write sits inside one
test-wide transaction, so a row that was never committed would still look
present. Here each `tenant_atomic` is a real transaction, the shape a
`non_atomic_requests` view runs in, so "committed" means committed.
"""

from __future__ import annotations

from django.test import TransactionTestCase, override_settings

from apps.school_organization.tests.factories import TenantFactory, UserFactory
from core.ai.exceptions import AIQuotaExceeded, AIUnavailable
from core.ai.grounding import GroundingContext
from core.ai.models import AIOutcome, AIRequest
from core.ai.providers.fake import fake_provider, ok_result
from core.ai.service import run_feature
from core.ai.tests.base import PROBE_FLAG, PROBE_KEY, ensure_probe_feature, set_flag
from core.tenancy.context import tenant_atomic


class AuditCommitTests(TransactionTestCase):
    def setUp(self) -> None:
        super().setUp()
        ensure_probe_feature()
        self.tenant = TenantFactory()
        with tenant_atomic(self.tenant.id):
            self.user = UserFactory(tenant=self.tenant)
        with tenant_atomic(self.tenant.id):
            set_flag(self.tenant, PROBE_FLAG, enabled=True)

    def run_probe(self) -> None:
        run_feature(
            feature_key=PROBE_KEY,
            user=self.user,
            tenant=self.tenant,
            user_prompt="Summarise.",
            input_ref="test:probe",
            grounding=GroundingContext(facts={}),
        )

    def committed(self) -> list[str]:
        # A fresh transaction: it sees only what an earlier one committed.
        with tenant_atomic(self.tenant.id):
            return list(AIRequest.objects.values_list("outcome", flat=True))

    @override_settings(AI_USER_DAILY_TOKEN_CAP=0)
    def test_refusal_row_survives_the_error_response(self) -> None:
        with self.assertRaises(AIQuotaExceeded):
            self.run_probe()

        self.assertEqual(self.committed(), [AIOutcome.QUOTA])
        self.assertEqual(fake_provider.calls, [])

    def test_a_refused_answer_commits_exactly_one_row(self) -> None:
        fake_provider.script(ok_result("Invented 42."))

        with self.assertRaises(AIUnavailable):
            self.run_probe()

        self.assertEqual(self.committed(), [AIOutcome.REFUSED])
