"""AI-FEE-02 as production runs it: a bearer token, no session, real transactions.

`FinanceReportSummaryView` is `non_atomic_requests`, so it opens its own transactions:
one around `initial` (the tenant binding is a `SET LOCAL`, so the flag, role and
throttle reads need one) and a `tenant_atomic` around the facts read. Under `TestCase`
both are hidden: the test-wide transaction keeps any binding alive, and `force_login`
gives the middleware a session that production never has. So these tests use a
`TransactionTestCase` and the token alone, as `tests/test_tenant_binding.py` does.
Remove either transaction and they fail: without the first the request is refused
(403), without the second RLS hides every row and the facts come back empty.
"""

from __future__ import annotations

import datetime

from rest_framework.test import APITransactionTestCase
from rest_framework_simplejwt.tokens import AccessToken

from apps.fees_finance import ai
from apps.fees_finance.services import ensure_system_accounts
from apps.fees_finance.tests.base import FEATURE
from apps.fees_finance.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    FeeHeadFactory,
    FeeInvoiceFactory,
    FeeInvoiceLineFactory,
    StudentFactory,
    TenantFactory,
    UserFactory,
    enable_feature,
    grant,
)
from core.ai.models import AIOutcome, AIRequest
from core.ai.providers.fake import fake_provider, ok_result
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_atomic

URL = "/api/v1/reports/finance-summary:summarize"
BODY = {"kind": "outstanding-aging", "date_from": "2026-01-01", "date_to": "2026-12-31"}


class SummaryUnderTokenAuthTests(APITransactionTestCase):
    def setUp(self) -> None:
        super().setUp()
        fake_provider.reset()
        self.addCleanup(fake_provider.reset)
        self.tenant = TenantFactory()
        # `tenant_atomic`, not `tenant_context`: outside a transaction the binding
        # would unwind before the next statement and RLS would refuse the writes.
        with tenant_atomic(self.tenant.id):
            enable_feature(self.tenant, FEATURE)
            enable_feature(self.tenant, ai.FEATURE_FLAG)
            accounts = ensure_system_accounts(tenant_id=self.tenant.pk)
            head = FeeHeadFactory(tenant=self.tenant, ledger_account=accounts["4000"])
            session = AcademicSessionFactory(tenant=self.tenant, is_current=True)
            self.campus = CampusFactory(tenant=self.tenant)
            other_campus = CampusFactory(tenant=self.tenant)
            for number, campus in enumerate((self.campus, other_campus)):
                invoice = FeeInvoiceFactory(
                    tenant=self.tenant,
                    student=StudentFactory(tenant=self.tenant, campus=campus),
                    academic_session=session,
                    issue_date=datetime.date(2026, 6, 1),
                    due_date=datetime.date(2026, 7, 1),
                    invoice_no=f"INV-COMMIT-{number}",
                )
                FeeInvoiceLineFactory(
                    tenant=self.tenant, fee_invoice=invoice, fee_head=head, amount=invoice.subtotal
                )
            user = UserFactory(tenant=self.tenant)
            grant(
                user,
                "fees.report.view",
                "fees.report.summarize",
                scope=RecordScope.CAMPUS,
                scope_ref=self.campus.pk,
            )
        # Token only: no `force_login`, so there is no session to resolve the tenant from.
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")

    def committed_outcomes(self) -> list[str]:
        # A fresh transaction sees only what an earlier one committed.
        with tenant_atomic(self.tenant.id):
            return list(AIRequest.objects.values_list("outcome", flat=True))

    def test_summary_answers_with_the_callers_campus_facts(self) -> None:
        fake_provider.script(ok_result("{{fact:student_count}} families owe money."))

        response = self.client.post(URL, BODY, format="json")

        self.assertEqual(response.status_code, 200, response.content)
        facts = response.json()["data"]["facts"]
        self.assertEqual(facts["student_count"], "1")
        self.assertEqual(facts["invoice_count"], "1")
        self.assertEqual(response.json()["data"]["summary"], "1 families owe money.")
        self.assertEqual(self.committed_outcomes(), [AIOutcome.OK])

    def test_a_503_leaves_exactly_one_committed_refused_row(self) -> None:
        fake_provider.script(ok_result("Families owe 9,999 in total."))

        response = self.client.post(URL, BODY, format="json")

        self.assertEqual(response.status_code, 503, response.content)
        self.assertEqual(response.json()["error"]["code"], "ai_unavailable")
        self.assertEqual(self.committed_outcomes(), [AIOutcome.REFUSED])
