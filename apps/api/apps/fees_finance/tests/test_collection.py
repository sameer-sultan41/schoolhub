"""Money arriving: payments, receipts, refunds and the ledger they move.

The case this file exists for is `test_the_posting_and_the_payment_commit_together`.
A confirmed payment with no ledger entry is a reconciliation failure nobody
discovers until year end, and by then the receipt is in a parent's hand — so the
transaction boundary is asserted directly rather than assumed from the fact that
the code is wrapped in `atomic`.

The second is the concurrency one. Two cashiers taking the same last instalment
both read the same balance and both pass the check unless the invoice is locked;
that is the missing-`select_for_update` finding PR #53's review produced, and
`test_two_simultaneous_payments_cannot_overpay` is what keeps it fixed.
"""

from __future__ import annotations

from decimal import Decimal
from unittest import mock

from django.db import connection, transaction
from django.test.utils import CaptureQueriesContext

from apps.fees_finance import services
from apps.fees_finance.models import (
    FeeInvoice,
    InvoiceStatus,
    LedgerEntry,
    LedgerReferenceType,
    Payment,
    PaymentMethod,
    PaymentStatus,
    Receipt,
    Refund,
    RefundStatus,
)
from apps.fees_finance.tests.base import FeesFinanceAPITestCase
from apps.fees_finance.tests.factories import FeeHeadFactory, FeeInvoiceFactory
from core.api.exceptions import DomainRuleViolation
from core.money import ZERO
from core.tenancy.context import tenant_context


class CollectionTestCase(FeesFinanceAPITestCase):
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
            from apps.fees_finance.tests.factories import FeeInvoiceLineFactory

            FeeInvoiceLineFactory(
                tenant=self.tenant,
                fee_invoice=self.invoice,
                fee_head=self.head,
                amount=Decimal("1000.00"),
            )

    def _pay(self, amount=Decimal("400.00"), method=PaymentMethod.CASH, **kwargs) -> Payment:
        with tenant_context(self.tenant.id):
            return services.record_payment(
                invoice=self.invoice,
                amount=amount,
                method=method,
                reference_no=kwargs.pop("reference_no", None),
                gateway_provider=None,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
                **kwargs,
            )


class PaymentTests(CollectionTestCase):
    def test_a_payment_issues_a_receipt_and_moves_the_invoice(self) -> None:
        payment = self._pay(Decimal("400.00"))

        with tenant_context(self.tenant.id):
            self.invoice.refresh_from_db()
            receipt = Receipt.objects.get(payment=payment)

        self.assertEqual(payment.status, PaymentStatus.CONFIRMED)
        self.assertEqual(self.invoice.paid_total, Decimal("400.00"))
        self.assertEqual(self.invoice.balance_due, Decimal("600.00"))
        self.assertEqual(self.invoice.status, InvoiceStatus.PARTIALLY_PAID)
        self.assertEqual(receipt.amount, Decimal("400.00"))

    def test_settling_in_full_marks_the_invoice_paid(self) -> None:
        self._pay(Decimal("1000.00"))

        with tenant_context(self.tenant.id):
            self.invoice.refresh_from_db()

        self.assertEqual(self.invoice.balance_due, ZERO)
        self.assertEqual(self.invoice.status, InvoiceStatus.PAID)

    def test_a_payment_above_the_balance_is_refused(self) -> None:
        """§11's default. Advance payment is a §19 recommendation and is not
        built — see §20."""
        with self.assertRaises(DomainRuleViolation) as caught:
            self._pay(Decimal("1500.00"))

        self.assertEqual(caught.exception.meta["balance_due"], "1000.00")

    def test_a_payment_against_a_canceled_invoice_is_refused(self) -> None:
        with tenant_context(self.tenant.id):
            services.cancel_invoice(
                invoice=self.invoice, reason="Wrong structure", actor_id=self.user.pk
            )

        with self.assertRaises(DomainRuleViolation):
            self._pay()

    def test_a_confirmed_payment_posts_a_balanced_ledger_transaction(self) -> None:
        payment = self._pay(Decimal("400.00"))

        with tenant_context(self.tenant.id):
            lines = list(
                LedgerEntry.objects.filter(
                    reference_type=LedgerReferenceType.PAYMENT, reference_id=payment.pk
                )
            )

        debits = sum(line.debit for line in lines)
        credits = sum(line.credit for line in lines)
        self.assertEqual(debits, Decimal("400.00"))
        self.assertEqual(credits, Decimal("400.00"))

    def test_cash_debits_cash_and_a_transfer_debits_the_bank(self) -> None:
        """A school reconciling a bank statement needs the two separated."""
        cash_payment = self._pay(Decimal("100.00"))
        transfer = self._pay(
            Decimal("200.00"), method=PaymentMethod.BANK_TRANSFER, reference_no="TRX-1"
        )

        with tenant_context(self.tenant.id):
            cash_debit = LedgerEntry.objects.get(reference_id=cash_payment.pk, debit__gt=0)
            bank_debit = LedgerEntry.objects.get(reference_id=transfer.pk, debit__gt=0)

        self.assertEqual(cash_debit.ledger_account_id, self.cash.pk)
        self.assertEqual(bank_debit.ledger_account_id, self.bank.pk)

    def test_the_income_side_is_split_across_the_heads_the_invoice_charged(self) -> None:
        """A school that maps transport to its own account expects the transport
        share to land there rather than in general fee income."""
        with tenant_context(self.tenant.id):
            from apps.fees_finance.tests.factories import (
                FeeInvoiceLineFactory,
                LedgerAccountFactory,
            )

            transport_account = LedgerAccountFactory(tenant=self.tenant, code="4200")
            transport_head = FeeHeadFactory(tenant=self.tenant, ledger_account=transport_account)
            FeeInvoiceLineFactory(
                tenant=self.tenant,
                fee_invoice=self.invoice,
                fee_head=transport_head,
                amount=Decimal("1000.00"),
            )
            FeeInvoice.objects.filter(pk=self.invoice.pk).update(
                subtotal=Decimal("2000.00"), balance_due=Decimal("2000.00")
            )
            self.invoice.refresh_from_db()

        payment = self._pay(Decimal("2000.00"))

        with tenant_context(self.tenant.id):
            credits = {
                entry.ledger_account_id: entry.credit
                for entry in LedgerEntry.objects.filter(reference_id=payment.pk, credit__gt=0)
            }

        self.assertEqual(credits[self.fee_income.pk], Decimal("1000.00"))
        self.assertEqual(credits[transport_account.pk], Decimal("1000.00"))

    def test_the_rounding_remainder_lands_on_the_largest_share_not_the_smallest(self) -> None:
        """A one-cent drift lands proportionally lighter against the largest
        share than the smallest — the docstring's stated intent. A part
        payment of 1000.00 split 2000/500/500 gives the two smaller shares
        `quantize_money(1000 * 500/3000)` = `166.67` each (rounded up from
        `166.666...`), which between them consume 0.02 more than their exact
        proportional share — the largest share absorbs that back as its
        remainder, landing on `666.66` rather than its own naively-rounded
        `666.67`.
        """
        with tenant_context(self.tenant.id):
            from apps.fees_finance.tests.factories import (
                FeeInvoiceLineFactory,
                LedgerAccountFactory,
            )

            transport_account = LedgerAccountFactory(tenant=self.tenant, code="4200")
            transport_head = FeeHeadFactory(tenant=self.tenant, ledger_account=transport_account)
            library_account = LedgerAccountFactory(tenant=self.tenant, code="4300")
            library_head = FeeHeadFactory(tenant=self.tenant, ledger_account=library_account)
            FeeInvoiceLineFactory(
                tenant=self.tenant,
                fee_invoice=self.invoice,
                fee_head=transport_head,
                amount=Decimal("500.00"),
            )
            FeeInvoiceLineFactory(
                tenant=self.tenant,
                fee_invoice=self.invoice,
                fee_head=library_head,
                amount=Decimal("500.00"),
            )
            # The default head from setUp carries the invoice's original
            # 1000.00 line; raised to 2000.00 so it is the largest of the
            # three shares.
            FeeInvoiceLineFactory(
                tenant=self.tenant,
                fee_invoice=self.invoice,
                fee_head=self.head,
                amount=Decimal("1000.00"),
            )
            FeeInvoice.objects.filter(pk=self.invoice.pk).update(
                subtotal=Decimal("3000.00"), balance_due=Decimal("3000.00")
            )
            self.invoice.refresh_from_db()

        payment = self._pay(Decimal("1000.00"))

        with tenant_context(self.tenant.id):
            credits = {
                entry.ledger_account_id: entry.credit
                for entry in LedgerEntry.objects.filter(reference_id=payment.pk, credit__gt=0)
            }

        self.assertEqual(credits[transport_account.pk], Decimal("166.67"))
        self.assertEqual(credits[library_account.pk], Decimal("166.67"))
        self.assertEqual(credits[self.fee_income.pk], Decimal("666.66"))
        self.assertEqual(sum(credits.values()), Decimal("1000.00"))

    def test_the_posting_and_the_payment_commit_together(self) -> None:
        """The guarantee the whole transaction exists for.

        Forcing the ledger posting to fail must leave no payment and no receipt
        behind — a confirmed payment with no ledger entry is unreconcilable, and
        by then the receipt is in a parent's hand.
        """
        with (
            tenant_context(self.tenant.id),
            # Patched on `services`, not on `ledger`: services binds the
            # name at import (`from ...ledger import post_transaction`), so
            # replacing the attribute on the ledger module would leave the
            # already-bound reference untouched and the test would pass without
            # exercising anything.
            mock.patch.object(
                services, "post_transaction", side_effect=RuntimeError("ledger is down")
            ),
            self.assertRaises(RuntimeError),
        ):
            services.record_payment(
                invoice=self.invoice,
                amount=Decimal("400.00"),
                method=PaymentMethod.CASH,
                reference_no=None,
                gateway_provider=None,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )

        with tenant_context(self.tenant.id):
            self.assertEqual(Payment.objects.count(), 0)
            self.assertEqual(Receipt.objects.count(), 0)
            self.invoice.refresh_from_db()
            self.assertEqual(self.invoice.paid_total, ZERO)

    def test_receipt_numbers_are_gapless_and_unique(self) -> None:
        self._pay(Decimal("100.00"))
        self._pay(Decimal("100.00"))
        self._pay(Decimal("100.00"))

        with tenant_context(self.tenant.id):
            numbers = sorted(Receipt.objects.values_list("receipt_no", flat=True))

        self.assertEqual(numbers, ["RCP-2026-00001", "RCP-2026-00002", "RCP-2026-00003"])

    def test_a_pending_payment_moves_nothing(self) -> None:
        """A gateway payment sits pending until its webhook arrives. A balance
        that moved on an unconfirmed payment is a receipt the school cannot
        honour if the webhook never comes."""
        with tenant_context(self.tenant.id):
            services.record_payment(
                invoice=self.invoice,
                amount=Decimal("400.00"),
                method=PaymentMethod.CASH,
                reference_no=None,
                gateway_provider=None,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
                confirm=False,
            )
            self.invoice.refresh_from_db()

        self.assertEqual(self.invoice.paid_total, ZERO)
        self.assertEqual(self.invoice.status, InvoiceStatus.ISSUED)

    def test_confirming_a_pending_payment_is_idempotent(self) -> None:
        """A retried webhook is a normal event, not a second receipt."""
        with tenant_context(self.tenant.id):
            payment = services.record_payment(
                invoice=self.invoice,
                amount=Decimal("400.00"),
                method=PaymentMethod.CASH,
                reference_no=None,
                gateway_provider=None,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
                confirm=False,
            )
            services.confirm_payment(
                payment=payment, actor_id=self.user.pk, tenant_id=self.tenant.pk
            )
            services.confirm_payment(
                payment=payment, actor_id=self.user.pk, tenant_id=self.tenant.pk
            )

            self.assertEqual(Receipt.objects.filter(payment=payment).count(), 1)
            self.invoice.refresh_from_db()

        self.assertEqual(self.invoice.paid_total, Decimal("400.00"))


class RefundTests(CollectionTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.payment = self._pay(Decimal("1000.00"))

    def _request(self, amount=Decimal("400.00"), actor=None) -> Refund:
        with tenant_context(self.tenant.id):
            return services.request_refund(
                payment=self.payment,
                amount=amount,
                reason="Overpaid the transport fee",
                actor_id=actor or self.user.pk,
                tenant_id=self.tenant.pk,
            )

    def test_the_requester_cannot_approve_their_own_refund(self) -> None:
        """§4's closing line and auth-and-rbac §2.4. Checked in `services`, not
        the viewset, because the rule is the module's: it has to hold when a
        later caller approves through some other door."""
        refund = self._request()

        with (
            tenant_context(self.tenant.id),
            self.assertRaises(DomainRuleViolation) as caught,
        ):
            services.decide_refund(refund=refund, approve=True, note=None, actor_id=self.user.pk)

        self.assertIn("cannot approve", str(caught.exception.detail))

    def test_a_second_approver_may_approve(self) -> None:
        from apps.fees_finance.tests.factories import UserFactory

        refund = self._request()
        approver = UserFactory(tenant=self.tenant)

        with tenant_context(self.tenant.id):
            decided = services.decide_refund(
                refund=refund, approve=True, note="Verified", actor_id=approver.pk
            )

        self.assertEqual(decided.status, RefundStatus.APPROVED)
        self.assertEqual(decided.approved_by, approver.pk)

    def test_two_partial_refunds_cannot_together_exceed_the_payment(self) -> None:
        """Bounded by the refundable *remainder*, which is a set-level rule no
        CHECK can see. `requested` counts too — otherwise two requests could
        each pass and only collide after an approver had agreed to both."""
        self._request(Decimal("600.00"))

        with (
            tenant_context(self.tenant.id),
            self.assertRaises(DomainRuleViolation) as caught,
        ):
            services.request_refund(
                payment=self.payment,
                amount=Decimal("600.00"),
                reason="Again",
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )

        self.assertEqual(caught.exception.meta["refundable_remainder"], "400.00")

    def test_a_non_refundable_head_blocks_the_request(self) -> None:
        """`fee_heads.is_refundable` exists precisely for this, and refusing at
        request time beats refusing after an approver has agreed."""
        with tenant_context(self.tenant.id):
            self.head.is_refundable = False
            self.head.save(update_fields=["is_refundable"])

        with (
            tenant_context(self.tenant.id),
            self.assertRaises(DomainRuleViolation) as caught,
        ):
            services.request_refund(
                payment=self.payment,
                amount=Decimal("100.00"),
                reason="Please",
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )

        self.assertIn("non-refundable", str(caught.exception.detail))

    def test_processing_an_unapproved_refund_is_refused(self) -> None:
        refund = self._request()

        with (
            tenant_context(self.tenant.id),
            self.assertRaises(DomainRuleViolation),
        ):
            services.process_refund(
                refund=refund,
                method=PaymentMethod.BANK_TRANSFER,
                reference_no="RF-1",
                actor_id=self.user.pk,
            )

    def test_a_full_refund_reverses_the_original_posting(self) -> None:
        """A reversal, never an edit: the original lines stay exactly as made."""
        from apps.fees_finance.tests.factories import UserFactory

        refund = self._request(Decimal("1000.00"))
        approver = UserFactory(tenant=self.tenant)

        with tenant_context(self.tenant.id):
            services.decide_refund(refund=refund, approve=True, note=None, actor_id=approver.pk)
            services.process_refund(
                refund=refund,
                method=PaymentMethod.BANK_TRANSFER,
                reference_no="RF-1",
                actor_id=approver.pk,
            )

            original = LedgerEntry.objects.filter(
                reference_type=LedgerReferenceType.PAYMENT, reference_id=self.payment.pk
            ).first()
            self.invoice.refresh_from_db()

        self.assertIsNotNone(original.reversed_by_transaction_id)
        self.assertEqual(self.invoice.paid_total, ZERO)
        self.assertEqual(self.invoice.balance_due, Decimal("1000.00"))

    def test_a_partial_refund_posts_its_own_balanced_transaction(self) -> None:
        """It cannot mirror the original — it moves a different amount — so it
        is its own posting, tagged `refund` rather than `reversal`."""
        from apps.fees_finance.tests.factories import UserFactory

        refund = self._request(Decimal("250.00"))
        approver = UserFactory(tenant=self.tenant)

        with tenant_context(self.tenant.id):
            services.decide_refund(refund=refund, approve=True, note=None, actor_id=approver.pk)
            services.process_refund(
                refund=refund,
                method=PaymentMethod.CASH,
                reference_no=None,
                actor_id=approver.pk,
            )

            lines = list(
                LedgerEntry.objects.filter(
                    reference_type=LedgerReferenceType.REFUND, reference_id=refund.pk
                )
            )
            self.invoice.refresh_from_db()

        self.assertEqual(sum(line.debit for line in lines), Decimal("250.00"))
        self.assertEqual(sum(line.credit for line in lines), Decimal("250.00"))
        self.assertEqual(self.invoice.paid_total, Decimal("750.00"))
        self.assertEqual(self.invoice.status, InvoiceStatus.PARTIALLY_PAID)

    def test_a_partial_refund_is_not_blocked_by_an_account_archived_since_payment(self) -> None:
        """The same exemption `reverse_transaction` gets, extended to a partial.

        A partial refund mirrors the original payment's own accounts — cash and
        fee income here — so if either was archived in the meantime, this is
        exactly the "refund against a payment that posted there" case
        `assert_accounts_are_postable`'s docstring names. A full refund of the
        same payment would already succeed; a partial one must not be the odd
        one out.
        """
        from apps.fees_finance.models import LedgerAccount
        from apps.fees_finance.tests.factories import UserFactory

        refund = self._request(Decimal("250.00"))
        approver = UserFactory(tenant=self.tenant)

        with tenant_context(self.tenant.id):
            LedgerAccount.objects.filter(pk=self.cash.pk).update(is_active=False)

            services.decide_refund(refund=refund, approve=True, note=None, actor_id=approver.pk)
            services.process_refund(
                refund=refund,
                method=PaymentMethod.CASH,
                reference_no=None,
                actor_id=approver.pk,
            )

            lines = list(
                LedgerEntry.objects.filter(
                    reference_type=LedgerReferenceType.REFUND, reference_id=refund.pk
                )
            )

        self.assertEqual(sum(line.debit for line in lines), Decimal("250.00"))
        self.assertEqual(sum(line.credit for line in lines), Decimal("250.00"))

    def test_a_partial_refund_across_several_credit_lines_still_balances(self) -> None:
        """Three credit lines splitting the income side, and a refund amount
        that does not divide evenly among them: `1000 * (1000/3000)` rounds to
        `333.33` a head, and three heads sum to `999.99` — a cent short of the
        `1000.00` being refunded. The remainder has to land on a credit line
        specifically, or the posting fails `assert_balanced` whenever the
        single cash line happens to be the one an unordered fetch returns
        last — undetectable from a single ledger account, which is why
        `test_a_partial_refund_posts_its_own_balanced_transaction` above does
        not catch it.
        """
        from apps.fees_finance.tests.factories import (
            FeeInvoiceLineFactory,
            LedgerAccountFactory,
            UserFactory,
        )

        # A fresh invoice, not `self.invoice` — `RefundTests.setUp` already
        # pays 1000.00 against that one, and this scenario needs its own
        # unpaid 3000.00 charge to refund a fresh 1000.00 from.
        with tenant_context(self.tenant.id):
            second_head = FeeHeadFactory(
                tenant=self.tenant,
                ledger_account=LedgerAccountFactory(tenant=self.tenant, code="4200"),
            )
            third_head = FeeHeadFactory(
                tenant=self.tenant,
                ledger_account=LedgerAccountFactory(tenant=self.tenant, code="4300"),
            )
            invoice = FeeInvoiceFactory(
                tenant=self.tenant,
                student=self.student,
                academic_session=self.session,
                subtotal=Decimal("3000.00"),
                period_label="2026-10",
            )
            FeeInvoiceLineFactory(
                tenant=self.tenant,
                fee_invoice=invoice,
                fee_head=self.head,
                amount=Decimal("1000.00"),
            )
            FeeInvoiceLineFactory(
                tenant=self.tenant,
                fee_invoice=invoice,
                fee_head=second_head,
                amount=Decimal("1000.00"),
            )
            FeeInvoiceLineFactory(
                tenant=self.tenant,
                fee_invoice=invoice,
                fee_head=third_head,
                amount=Decimal("1000.00"),
            )
            payment = services.record_payment(
                invoice=invoice,
                amount=Decimal("3000.00"),
                method=PaymentMethod.CASH,
                reference_no=None,
                gateway_provider=None,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )
        approver = UserFactory(tenant=self.tenant)

        with tenant_context(self.tenant.id):
            refund = services.request_refund(
                payment=payment,
                amount=Decimal("1000.00"),
                reason="Overcharged one head",
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )
            services.decide_refund(refund=refund, approve=True, note=None, actor_id=approver.pk)
            services.process_refund(
                refund=refund,
                method=PaymentMethod.CASH,
                reference_no=None,
                actor_id=approver.pk,
            )

            lines = list(
                LedgerEntry.objects.filter(
                    reference_type=LedgerReferenceType.REFUND, reference_id=refund.pk
                )
            )

        self.assertEqual(sum(line.debit for line in lines), Decimal("1000.00"))
        self.assertEqual(sum(line.credit for line in lines), Decimal("1000.00"))

    def test_a_rejected_refund_moves_no_money(self) -> None:
        from apps.fees_finance.tests.factories import UserFactory

        refund = self._request(Decimal("400.00"))
        approver = UserFactory(tenant=self.tenant)

        with tenant_context(self.tenant.id):
            # The returned instance, not the local one: `decide_refund` locks
            # and re-reads the row, so the object passed in stays at its old
            # status. Asserting on the stale local is how a passing test hides
            # a service that never wrote anything.
            decided = services.decide_refund(
                refund=refund, approve=False, note="Not eligible", actor_id=approver.pk
            )
            self.invoice.refresh_from_db()

        self.assertEqual(decided.status, RefundStatus.REJECTED)
        self.assertEqual(self.invoice.paid_total, Decimal("1000.00"))

    def test_a_rejected_refund_releases_the_remainder(self) -> None:
        """A rejected request must not keep the amount reserved, or a family
        would be permanently unable to ask again."""
        from apps.fees_finance.tests.factories import UserFactory

        refund = self._request(Decimal("1000.00"))
        approver = UserFactory(tenant=self.tenant)

        with tenant_context(self.tenant.id):
            services.decide_refund(
                refund=refund, approve=False, note="Not eligible", actor_id=approver.pk
            )
            remaining = services.refundable_remainder(payment=self.payment)

        self.assertEqual(remaining, Decimal("1000.00"))


class ConcurrencyTests(CollectionTestCase):
    def test_the_invoice_is_locked_while_a_payment_is_taken(self) -> None:
        """Two cashiers taking the same last instalment.

        Without `SELECT ... FOR UPDATE` both read the same balance, both pass
        the check, and the invoice ends up overpaid — the missing-lock finding
        PR #53's review produced. Asserted against the SQL actually issued,
        because a genuine race needs two connections and mocking the manager
        would only prove the mock was called.
        """
        with tenant_context(self.tenant.id), CaptureQueriesContext(connection) as queries:
            services.record_payment(
                invoice=self.invoice,
                amount=Decimal("100.00"),
                method=PaymentMethod.CASH,
                reference_no=None,
                gateway_provider=None,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )

        locked_invoice_reads = [
            query["sql"]
            for query in queries.captured_queries
            if "FOR UPDATE" in query["sql"] and "fee_invoices" in query["sql"]
        ]
        self.assertTrue(locked_invoice_reads, "record_payment must read the invoice FOR UPDATE")

    def test_the_same_idempotency_key_cannot_take_the_money_twice(self) -> None:
        """The database half. `replay_or_execute` documents itself as
        check-then-store and therefore not concurrency-safe, so the partial
        unique index is what actually stops two simultaneous submits."""
        from django.db import IntegrityError

        self._pay(Decimal("100.00"), idempotency_key="counter-1")

        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(IntegrityError),
        ):
            services.record_payment(
                invoice=self.invoice,
                amount=Decimal("100.00"),
                method=PaymentMethod.CASH,
                reference_no=None,
                gateway_provider=None,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
                idempotency_key="counter-1",
            )
