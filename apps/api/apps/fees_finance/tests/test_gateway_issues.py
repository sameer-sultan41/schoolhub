"""Gateway discrepancies: money that has already moved, and how staff book it.

Money already received always posts — a settled bank voucher during a pending
checkout is not sent to an exceptions queue — and the disagreement becomes an
issue. `:resolve` books money at the amount the provider verified, with a receipt
and a ledger posting, or dismisses it with a note; never just a note while the
money sits unbooked.
"""

from __future__ import annotations

from decimal import Decimal

from apps.fees_finance import services
from apps.fees_finance.adapters import adapter_for as settlement_adapter_for
from apps.fees_finance.models import (
    GatewayIssueKind,
    GatewayIssueResolution,
    GatewayReconciliationIssue,
    LedgerEntry,
    Payment,
    PaymentStatus,
    Receipt,
    VoucherCollectionImport,
    VoucherProvider,
)
from apps.fees_finance.tests.factories import settlement_csv
from apps.fees_finance.tests.online_base import OnlinePaymentsTestCase
from core.files.services import create_ready_file
from core.tenancy.context import tenant_context


class GatewayIssueTestCase(OnlinePaymentsTestCase):
    def resolve(self, issue, **body):
        return self.client.post(
            f"/api/v1/gateway-reconciliation-issues/{issue.pk}:resolve", body, format="json"
        )

    def issues(self, kind: str) -> list[GatewayReconciliationIssue]:
        with tenant_context(self.tenant.id):
            return list(GatewayReconciliationIssue.objects.filter(kind=kind))


class SettlementDuringCheckoutTests(GatewayIssueTestCase):
    def test_voucher_settlement_during_pending_online_posts_and_flags_overpaid(self) -> None:
        with tenant_context(self.tenant.id):
            voucher = services.issue_voucher(
                invoice=self.invoice,
                provider=VoucherProvider.BANK_BRANCH,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )
        self.pending_payment()
        rows = [(voucher.consumer_number, "TRX-1", "1000.00", "2026-09-05")]

        with tenant_context(self.tenant.id):
            stored = create_ready_file(
                tenant_id=self.tenant.pk,
                purpose="fees.settlement-file",
                original_name="settlement.csv",
                mime_type="text/csv",
                data=settlement_csv(rows),
                actor_id=self.user.pk,
            )
            record = VoucherCollectionImport.objects.create(
                tenant=self.tenant,
                provider=VoucherProvider.BANK_BRANCH,
                file=stored,
                imported_by=self.user.pk,
            )
            parsed = settlement_adapter_for(VoucherProvider.BANK_BRANCH).parse(settlement_csv(rows))
            result = services.apply_settlement_rows(
                voucher_import=record,
                rows=parsed.rows,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )
            settled = Payment.objects.get(reference_no="TRX-1")

        self.assertEqual(result["matched"], 1)
        self.assertEqual(result["exceptions"], 0)
        self.assertEqual(settled.status, PaymentStatus.CONFIRMED)
        [overpaid] = self.issues(GatewayIssueKind.OVERPAID)
        self.assertEqual(overpaid.payment_id, settled.pk)
        self.assertEqual(overpaid.expected_amount, Decimal("0.00"))
        self.assertEqual(overpaid.gateway_amount, Decimal("1000.00"))


class ResolveTests(GatewayIssueTestCase):
    def test_resolve_book_at_gateway_amount_confirms_and_posts(self) -> None:
        payment = self.pending_payment()
        self.callback(self.provider_has(payment, amount="900.00"))
        [issue] = self.issues(GatewayIssueKind.AMOUNT_MISMATCH)

        response = self.resolve(issue, action="book_at_gateway_amount")

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["data"]["resolution"], GatewayIssueResolution.BOOKED)
        payment = self.reload(payment)
        self.assertEqual(payment.status, PaymentStatus.CONFIRMED)
        self.assertEqual(payment.amount, Decimal("900.00"))
        with tenant_context(self.tenant.id):
            self.assertTrue(Receipt.objects.filter(payment=payment).exists())
            debits = sum(
                LedgerEntry.objects.filter(reference_id=payment.pk).values_list("debit", flat=True)
            )
        self.assertEqual(debits, Decimal("900.00"))
        self.assertEqual(self.invoice_now().balance_due, Decimal("100.00"))

    def test_resolve_unknown_reference_books_new_payment(self) -> None:
        order_id = f"SH-{self.invoice.invoice_no}-0badc0de"
        event = self.provider_has(
            Payment(reference_no=order_id, amount=Decimal("1000.00")), txn="TXN-UNKNOWN"
        )
        self.callback(event)
        [issue] = self.issues(GatewayIssueKind.UNKNOWN_REFERENCE)
        self.assertIsNone(issue.payment_id)

        response = self.resolve(issue, action="book_at_gateway_amount")

        self.assertEqual(response.status_code, 200, response.content)
        issue = self.reload(issue)
        self.assertEqual(issue.resolution, GatewayIssueResolution.BOOKED)
        with tenant_context(self.tenant.id):
            booked = Payment.objects.get(pk=issue.payment_id)
            self.assertTrue(Receipt.objects.filter(payment=booked).exists())
        self.assertEqual(booked.status, PaymentStatus.CONFIRMED)
        self.assertEqual(booked.reference_no, order_id)
        self.assertEqual(booked.provider_txn_id, "TXN-UNKNOWN")
        self.assertEqual(booked.amount, Decimal("1000.00"))
        self.assertEqual(self.invoice_now().balance_due, Decimal("0.00"))

    def test_resolve_dismiss_requires_note(self) -> None:
        payment = self.pending_payment()
        self.callback(self.provider_has(payment, amount="900.00"))
        [issue] = self.issues(GatewayIssueKind.AMOUNT_MISMATCH)

        refused = self.resolve(issue, action="dismiss")
        dismissed = self.resolve(issue, action="dismiss", note="Refunded at provider")

        self.assertEqual(refused.status_code, 400)
        self.assertEqual(dismissed.status_code, 200, dismissed.content)
        issue = self.reload(issue)
        self.assertEqual(issue.resolution, GatewayIssueResolution.DISMISSED)
        self.assertEqual(issue.note, "Refunded at provider")
        self.assertEqual(self.reload(payment).status, PaymentStatus.PENDING)

    def test_an_issue_is_resolved_once(self) -> None:
        payment = self.pending_payment()
        self.callback(self.provider_has(payment, amount="900.00"))
        [issue] = self.issues(GatewayIssueKind.AMOUNT_MISMATCH)
        self.resolve(issue, action="dismiss", note="Refunded at provider")

        again = self.resolve(issue, action="book_at_gateway_amount")

        self.assertEqual(again.status_code, 409)
        self.assertEqual(self.reload(payment).status, PaymentStatus.PENDING)

    def test_the_issue_list_is_staff_only(self) -> None:
        self.assertEqual(self.client.get("/api/v1/gateway-reconciliation-issues").status_code, 200)
        self.assertEqual(
            self.guardian_client.get("/api/v1/gateway-reconciliation-issues").status_code, 403
        )
