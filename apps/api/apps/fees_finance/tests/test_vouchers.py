"""Vouchers and the settlement reconciliation that closes them.

§7.2's three properties, one class each: a voucher is never edited (only voided
and re-issued), a settlement row posts at most once, and an unmatched row lands
in a queue rather than failing the file.

The re-import case is the one that matters operationally. Re-importing
yesterday's file is a normal event — a bank re-sends, an accountant is unsure
whether the morning run completed — and it must be a no-op, not a second
payment against every voucher in it.
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from apps.fees_finance import services
from apps.fees_finance.adapters import adapter_for
from apps.fees_finance.models import (
    FeeVoucher,
    ImportStatus,
    InvoiceStatus,
    Payment,
    PaymentMethod,
    SettlementRow,
    VoucherCollectionImport,
    VoucherProvider,
    VoucherStatus,
)
from apps.fees_finance.tests.base import FeesFinanceAPITestCase
from apps.fees_finance.tests.factories import (
    FeeHeadFactory,
    FeeInvoiceFactory,
    FeeInvoiceLineFactory,
    settlement_csv,
)
from core.api.exceptions import DomainRuleViolation
from core.files.services import create_ready_file
from core.money import ZERO
from core.tenancy.context import tenant_context


class VoucherTestCase(FeesFinanceAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.head = FeeHeadFactory(tenant=self.tenant, ledger_account=self.fee_income)
            self.invoice = FeeInvoiceFactory(
                tenant=self.tenant,
                student=self.student,
                academic_session=self.session,
                subtotal=Decimal("1000.00"),
                period_label="2026-09",
            )
            FeeInvoiceLineFactory(
                tenant=self.tenant,
                fee_invoice=self.invoice,
                fee_head=self.head,
                amount=Decimal("1000.00"),
            )

    def _issue(self, **kwargs) -> FeeVoucher:
        with tenant_context(self.tenant.id):
            return services.issue_voucher(
                invoice=kwargs.pop("invoice", self.invoice),
                provider=kwargs.pop("provider", VoucherProvider.BANK_BRANCH),
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
                **kwargs,
            )


class IssuanceTests(VoucherTestCase):
    def test_a_voucher_snapshots_the_balance_at_issuance(self) -> None:
        """The printed slip says what the bank will collect. A balance that
        moves afterwards must not make an already-printed voucher unpayable —
        which is why the matcher compares against the voucher, not the invoice."""
        voucher = self._issue()

        self.assertEqual(voucher.amount, Decimal("1000.00"))
        self.assertEqual(voucher.status, VoucherStatus.ISSUED)

    def test_a_settled_invoice_takes_no_voucher(self) -> None:
        with tenant_context(self.tenant.id):
            services.record_payment(
                invoice=self.invoice,
                amount=Decimal("1000.00"),
                method=PaymentMethod.CASH,
                reference_no=None,
                gateway_provider=None,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )
            self.invoice.refresh_from_db()

        with self.assertRaises(DomainRuleViolation):
            self._issue()

    def test_a_canceled_invoice_takes_no_voucher(self) -> None:
        with tenant_context(self.tenant.id):
            services.cancel_invoice(
                invoice=self.invoice, reason="Wrong structure", actor_id=self.user.pk
            )

        with self.assertRaises(DomainRuleViolation):
            self._issue()

    def test_two_vouchers_for_one_invoice_get_distinct_consumer_numbers(self) -> None:
        """A re-issue must be distinguishable from the voided original, or a
        settlement row could not say which one it paid."""
        first = self._issue()
        with tenant_context(self.tenant.id):
            services.void_voucher(voucher=first, reason="Wrong provider", actor_id=self.user.pk)
        second = self._issue()

        self.assertNotEqual(first.consumer_number, second.consumer_number)

    def test_a_voucher_is_voided_not_edited(self) -> None:
        voucher = self._issue()

        with tenant_context(self.tenant.id):
            voided = services.void_voucher(
                voucher=voucher, reason="Amount was wrong", actor_id=self.user.pk
            )

        self.assertEqual(voided.status, VoucherStatus.VOID)
        self.assertEqual(voided.amount, Decimal("1000.00"))

    def test_voiding_requires_a_reason(self) -> None:
        voucher = self._issue()

        with (
            tenant_context(self.tenant.id),
            self.assertRaises(DomainRuleViolation),
        ):
            services.void_voucher(voucher=voucher, reason="  ", actor_id=self.user.pk)

    def test_settling_by_another_channel_voids_the_voucher(self) -> None:
        """§6. Without this a parent who paid at the counter could also pay the
        voucher at a bank, and the school would hold money it must refund."""
        voucher = self._issue()

        with tenant_context(self.tenant.id):
            services.record_payment(
                invoice=self.invoice,
                amount=Decimal("1000.00"),
                method=PaymentMethod.CASH,
                reference_no=None,
                gateway_provider=None,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )
            voucher.refresh_from_db()

        self.assertEqual(voucher.status, VoucherStatus.VOID)

    def test_a_part_payment_leaves_the_voucher_standing(self) -> None:
        """The balance the voucher names is still owed."""
        voucher = self._issue()

        with tenant_context(self.tenant.id):
            services.record_payment(
                invoice=self.invoice,
                amount=Decimal("300.00"),
                method=PaymentMethod.CASH,
                reference_no=None,
                gateway_provider=None,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )
            voucher.refresh_from_db()

        self.assertEqual(voucher.status, VoucherStatus.ISSUED)

    def test_an_overdue_voucher_expires_on_the_sweep(self) -> None:
        """An expired voucher still sitting `issued` would be matched by a late
        settlement file and post a payment the invoice may no longer owe."""
        voucher = self._issue()
        with tenant_context(self.tenant.id):
            FeeVoucher.objects.filter(pk=voucher.pk).update(due_date=datetime.date(2020, 1, 1))
            services.expire_tenant_vouchers(self.tenant.pk)
            voucher.refresh_from_db()

        self.assertEqual(voucher.status, VoucherStatus.EXPIRED)


class AdapterTests(FeesFinanceAPITestCase):
    def test_the_generic_csv_adapter_reads_the_documented_columns(self) -> None:
        parsed = adapter_for(VoucherProvider.BANK_BRANCH).parse(
            settlement_csv([("BAN00000001", "TRX-1", "1000.00", "2026-09-05")])
        )

        self.assertEqual(len(parsed.rows), 1)
        self.assertEqual(parsed.rows[0].amount, Decimal("1000.00"))
        self.assertEqual(parsed.problems, [])

    def test_a_bad_row_does_not_stop_the_good_ones(self) -> None:
        """One bank's typo must not stop four hundred other rows posting."""
        parsed = adapter_for(VoucherProvider.BANK_BRANCH).parse(
            settlement_csv(
                [
                    ("BAN00000001", "TRX-1", "1000.00", "2026-09-05"),
                    ("BAN00000002", "TRX-2", "not-a-number", "2026-09-05"),
                    ("BAN00000003", "TRX-3", "500.00", "2026-09-06"),
                ]
            )
        )

        self.assertEqual(len(parsed.rows), 2)
        self.assertEqual(len(parsed.problems), 1)
        self.assertEqual(parsed.problems[0]["provider_reference"], "TRX-2")

    def test_a_missing_column_is_a_whole_file_problem(self) -> None:
        data = b"consumer_number,amount,paid_on\nBAN1,10.00,2026-09-05\n"

        parsed = adapter_for(VoucherProvider.BANK_BRANCH).parse(data)

        self.assertEqual(parsed.rows, [])
        self.assertIn("transaction_reference", parsed.problems[0]["reason"])

    def test_an_unreadable_file_reaches_the_same_exceptions_queue(self) -> None:
        """Reported as row 0 rather than a different error path an accountant
        has never seen."""
        parsed = adapter_for(VoucherProvider.BANK_BRANCH).parse(b"\xff\xfe\x00binary")

        self.assertEqual(parsed.rows, [])
        self.assertEqual(parsed.problems[0]["row"], 0)

    def test_every_provider_has_an_adapter(self) -> None:
        """A provider with no adapter is a voucher nothing can ever reconcile."""
        for provider in VoucherProvider.values:
            self.assertIsNotNone(adapter_for(provider))

    def test_an_unknown_provider_raises_rather_than_returning_nothing(self) -> None:
        with self.assertRaises(LookupError):
            adapter_for("not-a-provider")


class SettlementTests(VoucherTestCase):
    def _import(self, rows: list[tuple[str, str, str, str]]) -> dict:
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
            parsed = adapter_for(VoucherProvider.BANK_BRANCH).parse(settlement_csv(rows))
            return services.apply_settlement_rows(
                voucher_import=record,
                rows=parsed.rows,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )

    def test_a_matching_row_pays_the_voucher_and_the_invoice(self) -> None:
        """A matched row goes through `record_payment`, so the settlement path
        gets the same balance check, receipt and ledger posting as a counter
        payment — otherwise the two would drift."""
        voucher = self._issue()

        result = self._import([(voucher.consumer_number, "TRX-1", "1000.00", "2026-09-05")])

        with tenant_context(self.tenant.id):
            voucher.refresh_from_db()
            self.invoice.refresh_from_db()
            payment = Payment.objects.get()

        self.assertEqual(result["matched"], 1)
        self.assertEqual(voucher.status, VoucherStatus.PAID)
        self.assertEqual(voucher.payment_id, payment.pk)
        self.assertEqual(self.invoice.status, InvoiceStatus.PAID)
        self.assertEqual(self.invoice.balance_due, ZERO)
        self.assertTrue(hasattr(payment, "receipt"))

    def test_re_importing_the_same_file_posts_nothing_further(self) -> None:
        """§11's match key. Re-importing yesterday's file is a normal
        operational event, and it must be a no-op rather than a second payment
        against every voucher in it."""
        voucher = self._issue()
        rows = [(voucher.consumer_number, "TRX-1", "1000.00", "2026-09-05")]
        self._import(rows)

        second = self._import(rows)

        with tenant_context(self.tenant.id):
            self.assertEqual(Payment.objects.count(), 1)
            self.assertEqual(SettlementRow.objects.count(), 1)
        self.assertEqual(second["matched"], 0)

    def test_a_row_with_no_matching_voucher_becomes_an_exception(self) -> None:
        self._issue()

        result = self._import([("NO-SUCH-NUMBER", "TRX-9", "1000.00", "2026-09-05")])

        self.assertEqual(result["matched"], 0)
        self.assertEqual(result["exceptions"], 1)
        with tenant_context(self.tenant.id):
            self.assertEqual(Payment.objects.count(), 0)

    def test_a_short_payment_becomes_an_exception_rather_than_posting(self) -> None:
        """A short or over payment is a decision — accept it, chase the
        difference, or re-issue — not an automatic posting."""
        voucher = self._issue()

        result = self._import([(voucher.consumer_number, "TRX-1", "900.00", "2026-09-05")])

        self.assertEqual(result["matched"], 0)
        self.assertEqual(result["exceptions"], 1)
        with tenant_context(self.tenant.id):
            voucher.refresh_from_db()
        self.assertEqual(voucher.status, VoucherStatus.ISSUED)

    def test_a_good_row_posts_even_when_another_row_fails(self) -> None:
        first = self._issue()
        with tenant_context(self.tenant.id):
            second_invoice = FeeInvoiceFactory(
                tenant=self.tenant,
                student=self.students[1],
                academic_session=self.session,
                subtotal=Decimal("1000.00"),
                period_label="2026-09",
                invoice_no="INV-2",
            )
            FeeInvoiceLineFactory(
                tenant=self.tenant,
                fee_invoice=second_invoice,
                fee_head=self.head,
                amount=Decimal("1000.00"),
            )
        second = self._issue(invoice=second_invoice)

        result = self._import(
            [
                (first.consumer_number, "TRX-1", "1000.00", "2026-09-05"),
                ("NO-SUCH-NUMBER", "TRX-2", "500.00", "2026-09-05"),
                (second.consumer_number, "TRX-3", "1000.00", "2026-09-05"),
            ]
        )

        self.assertEqual(result["matched"], 2)
        self.assertEqual(result["exceptions"], 1)

    def test_the_import_records_its_outcome(self) -> None:
        voucher = self._issue()
        self._import([(voucher.consumer_number, "TRX-1", "1000.00", "2026-09-05")])

        with tenant_context(self.tenant.id):
            record = VoucherCollectionImport.objects.get()

        self.assertEqual(record.status, ImportStatus.COMPLETED)
        self.assertEqual(record.matched_count, 1)
        self.assertIsNotNone(record.completed_at)
