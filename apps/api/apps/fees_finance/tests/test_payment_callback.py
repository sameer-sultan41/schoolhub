"""The provider's signed callback, and the money rules it is applied under.

Forged, replayed, misdirected and out-of-order callbacks are the review focus:
each has a test that a wrong implementation would fail. A callback is trusted
only after its signature verifies with *this* school's secret, and then only for
what the provider itself says when asked (the re-fetch), so the tests put the
truth in the fake provider's store with `provider_has`.
"""

from __future__ import annotations

import time
from decimal import Decimal

from apps.fees_finance import services
from apps.fees_finance.models import (
    GatewayIssueKind,
    GatewayReconciliationIssue,
    InvoiceStatus,
    LedgerEntry,
    PaymentMethod,
    PaymentStatus,
    Receipt,
)
from apps.fees_finance.tests.factories import TenantFactory, UserFactory
from apps.fees_finance.tests.online_base import OnlinePaymentsTestCase, make_account
from core.audit.models import AuditLog
from core.files.models import File
from core.money import ZERO
from core.tenancy.context import tenant_context


class CallbackTests(OnlinePaymentsTestCase):
    def test_paid_callback_confirms_issues_receipt_and_posts_ledger(self) -> None:
        payment = self.pending_payment()
        event = self.provider_has(payment)

        with self.captureOnCommitCallbacks(execute=True):
            response = self.callback(event)

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["data"], {"received": True})
        payment = self.reload(payment)
        self.assertEqual(payment.status, PaymentStatus.CONFIRMED)
        self.assertEqual(payment.provider_txn_id, "TXN-1")
        self.assertEqual(self.invoice_now().status, InvoiceStatus.PAID)
        with tenant_context(self.tenant.id):
            receipt = Receipt.objects.get(payment=payment)
            lines = list(LedgerEntry.objects.filter(reference_id=payment.pk))
            # The receipt PDF rendered with no actor: nobody took this payment.
            self.assertIsNotNone(receipt.pdf_file_id)
            self.assertIsNone(File.objects.get(pk=receipt.pdf_file_id).created_by)
        self.assertEqual(sum(line.debit for line in lines), Decimal("1000.00"))
        self.assertEqual(sum(line.credit for line in lines), Decimal("1000.00"))

    def test_bad_signature_is_400_and_confirms_nothing(self) -> None:
        payment = self.pending_payment()
        event = self.provider_has(payment)

        response = self.callback(event, tamper=True)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "invalid_signature")
        self.assertEqual(self.reload(payment).status, PaymentStatus.PENDING)
        self.assertTrue(
            AuditLog.objects.filter(
                tenant=self.tenant, action="payment_callback.invalid_signature"
            ).exists()
        )

    def test_stale_timestamp_is_400(self) -> None:
        payment = self.pending_payment()
        event = self.provider_has(payment)

        response = self.callback(event, timestamp=int(time.time()) - 3600)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.reload(payment).status, PaymentStatus.PENDING)

    def test_replayed_callback_confirms_once(self) -> None:
        payment = self.pending_payment()
        event = self.provider_has(payment)

        first = self.callback(event)
        second = self.callback(event)

        self.assertEqual((first.status_code, second.status_code), (200, 200))
        with tenant_context(self.tenant.id):
            self.assertEqual(Receipt.objects.filter(payment=payment).count(), 1)
            transactions = set(
                LedgerEntry.objects.filter(reference_id=payment.pk).values_list(
                    "transaction_id", flat=True
                )
            )
        self.assertEqual(len(transactions), 1)
        self.assertEqual(self.invoice_now().paid_total, Decimal("1000.00"))

    def test_other_schools_signature_is_rejected(self) -> None:
        other = TenantFactory()
        make_account(
            other,
            UserFactory(tenant=other).pk,
            credentials={"merchant_id": "OTHER-000001", "secret": "other-school-secret"},
        )
        payment = self.pending_payment()
        event = self.provider_has(payment)

        response = self.callback(event, secret="other-school-secret")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.reload(payment).status, PaymentStatus.PENDING)

    def test_unknown_token_is_404(self) -> None:
        payment = self.pending_payment()
        event = self.provider_has(payment)

        for kwargs in ({"token": "not-a-real-token"}, {"slug": "no-such-school"}):
            with self.subTest(**kwargs):
                self.assertEqual(self.callback(event, **kwargs).status_code, 404)
        self.assertEqual(self.reload(payment).status, PaymentStatus.PENDING)

    def test_callback_for_inactive_account_still_applies(self) -> None:
        payment = self.pending_payment()
        event = self.provider_has(payment)
        with tenant_context(self.tenant.id):
            type(self.account).objects.filter(pk=self.account.pk).update(is_active=False)

        response = self.callback(event)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.reload(payment).status, PaymentStatus.CONFIRMED)

    def test_failed_callback_marks_failed(self) -> None:
        payment = self.pending_payment()
        event = self.provider_has(payment, status="failed")

        response = self.callback(event)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.reload(payment).status, PaymentStatus.FAILED)
        self.assertEqual(self.invoice_now().paid_total, ZERO)

    def test_failed_callback_after_confirm_is_noop(self) -> None:
        payment = self.pending_payment()
        self.callback(self.provider_has(payment))

        late_failure = self.provider_has(payment, status="failed")
        response = self.callback(late_failure)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.reload(payment).status, PaymentStatus.CONFIRMED)
        self.assertEqual(self.invoice_now().status, InvoiceStatus.PAID)

    def test_a_callback_the_provider_does_not_know_changes_nothing(self) -> None:
        """Signed but not confirmed by the re-fetch: nothing is applied."""
        payment = self.pending_payment()
        event = self.provider_has(payment)
        self.adapter.reset()

        response = self.callback(event)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.reload(payment).status, PaymentStatus.PENDING)


class MoneyRuleTests(OnlinePaymentsTestCase):
    def _issues(self, kind: str) -> list[GatewayReconciliationIssue]:
        with tenant_context(self.tenant.id):
            return list(GatewayReconciliationIssue.objects.filter(kind=kind))

    def test_amount_mismatch_records_issue_without_confirming(self) -> None:
        payment = self.pending_payment()
        event = self.provider_has(payment, amount="900.00")

        response = self.callback(event)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.reload(payment).status, PaymentStatus.PENDING)
        [issue] = self._issues(GatewayIssueKind.AMOUNT_MISMATCH)
        self.assertEqual(issue.payment_id, payment.pk)
        self.assertEqual(issue.expected_amount, Decimal("1000.00"))
        self.assertEqual(issue.gateway_amount, Decimal("900.00"))
        with tenant_context(self.tenant.id):
            self.assertFalse(LedgerEntry.objects.filter(reference_id=payment.pk).exists())

    def test_amount_mismatch_trusts_the_provider_not_the_callback_body(self) -> None:
        """The body claims the full amount; the provider says 900 was paid."""
        payment = self.pending_payment()
        claimed = self.provider_has(payment)
        self.provider_has(payment, amount="900.00")

        self.callback(claimed)

        self.assertEqual(self.reload(payment).status, PaymentStatus.PENDING)
        self.assertEqual(len(self._issues(GatewayIssueKind.AMOUNT_MISMATCH)), 1)

    def test_late_paid_callback_after_expiry_confirms_and_flags_overpaid(self) -> None:
        payment = self.pending_payment()
        self.age(payment, minutes=61)
        with tenant_context(self.tenant.id):
            services.expire_tenant_pending_online_payments(self.tenant.pk)
            # The family then pays at the counter, which the expiry allows.
            services.record_payment(
                invoice=self.invoice,
                amount=Decimal("1000.00"),
                method=PaymentMethod.CASH,
                reference_no=None,
                gateway_provider=None,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )
        self.assertEqual(self.reload(payment).status, PaymentStatus.FAILED)

        response = self.callback(self.provider_has(payment))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.reload(payment).status, PaymentStatus.CONFIRMED)
        self.assertEqual(self.invoice_now().balance_due, Decimal("-1000.00"))
        self.assertEqual(len(self._issues(GatewayIssueKind.PAID_AFTER_FAILED)), 1)
        [overpaid] = self._issues(GatewayIssueKind.OVERPAID)
        self.assertEqual(overpaid.payment_id, payment.pk)

    def test_gateway_confirm_is_audited_with_system_actor(self) -> None:
        payment = self.pending_payment()

        self.callback(self.provider_has(payment))

        entry = AuditLog.objects.get(tenant=self.tenant, action="confirm", resource_id=payment.pk)
        self.assertIsNone(entry.actor_id)
        self.assertEqual(entry.after["order_id"], payment.reference_no)
        self.assertEqual(entry.after["provider_txn_id"], "TXN-1")
