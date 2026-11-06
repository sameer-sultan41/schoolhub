"""The nightly reconciliation against the provider's own transaction list (ADR-0034).

A callback can be lost: the provider's retries give up, the school's DNS was
down, a deploy dropped the request. Once a day the provider's list for a day is
compared with our payments, each event applied through the same
`handle_gateway_event` a callback uses, and what cannot be applied becomes a
`GatewayReconciliationIssue` for a person. It is safe to run twice.
"""

from __future__ import annotations

import datetime
from decimal import Decimal
from unittest import mock

from django.utils import timezone

from apps.fees_finance import services, tasks
from apps.fees_finance.models import (
    GatewayIssueKind,
    GatewayReconciliationIssue,
    LedgerEntry,
    Payment,
    PaymentMethod,
    PaymentStatus,
    Receipt,
)
from apps.fees_finance.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    FeeInvoiceFactory,
    StudentFactory,
    TenantFactory,
    enable_feature,
)
from apps.fees_finance.tests.online_base import (
    ONLINE_FEATURE,
    OnlinePaymentsTestCase,
    make_account,
)
from core.integrations.payments.base import GatewayEvent, GatewayUnavailable
from core.tenancy.context import tenant_context


class ReconciliationTests(OnlinePaymentsTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.day = timezone.now().date()

    def reconcile(self) -> int:
        return services.reconcile_gateway_day(account=self.account, day=self.day)

    def issues(self, kind: str) -> list[GatewayReconciliationIssue]:
        with tenant_context(self.tenant.id):
            return list(GatewayReconciliationIssue.objects.filter(kind=kind))

    def second_invoice(self):
        with tenant_context(self.tenant.id):
            return FeeInvoiceFactory(
                tenant=self.tenant,
                student=self.student,
                academic_session=self.session,
                period_label="2026-10",
            )

    def test_missed_callback_is_confirmed_by_reconciliation(self) -> None:
        payment = self.pending_payment()
        self.provider_has(payment, txn="TXN-MISSED")

        applied = self.reconcile()

        payment = self.reload(payment)
        self.assertEqual(payment.status, PaymentStatus.CONFIRMED)
        self.assertEqual(payment.provider_txn_id, "TXN-MISSED")
        self.assertEqual(self.invoice_now().paid_total, Decimal("1000.00"))
        self.assertEqual(applied, 1)
        with tenant_context(self.tenant.id):
            self.assertTrue(Receipt.objects.filter(payment=payment).exists())

    def test_missing_at_gateway_opens_one_issue(self) -> None:
        payment = self.pending_payment()
        self.callback(self.provider_has(payment))
        self.assertEqual(self.reload(payment).status, PaymentStatus.CONFIRMED)
        # The provider has no record of the money we confirmed.
        self.adapter.reset()

        self.reconcile()
        self.reconcile()

        missing = self.issues(GatewayIssueKind.MISSING_AT_GATEWAY)
        self.assertEqual(len(missing), 1)
        self.assertEqual(missing[0].payment_id, payment.pk)
        self.assertEqual(missing[0].order_id, payment.reference_no)
        self.assertEqual(missing[0].expected_amount, Decimal("1000.00"))
        # Nothing is reversed: a person decides.
        self.assertEqual(self.reload(payment).status, PaymentStatus.CONFIRMED)

    def test_duplicate_at_gateway_opens_issue(self) -> None:
        payment = self.pending_payment()
        first = self.provider_has(payment, txn="TXN-1")
        second = GatewayEvent(
            order_id=first.order_id,
            provider_txn_id="TXN-2",
            status="paid",
            amount=first.amount,
            occurred_at=first.occurred_at,
            sanitized={"order_id": first.order_id, "status": "paid"},
        )

        with mock.patch.object(self.adapter, "list_transactions", return_value=[first, second]):
            self.reconcile()

        payment = self.reload(payment)
        self.assertEqual(payment.status, PaymentStatus.CONFIRMED)
        self.assertEqual(payment.provider_txn_id, "TXN-1")
        # The second transaction is money too, but it is not posted twice.
        self.assertEqual(self.invoice_now().paid_total, Decimal("1000.00"))
        duplicates = self.issues(GatewayIssueKind.DUPLICATE_AT_GATEWAY)
        self.assertEqual(len(duplicates), 1)
        self.assertEqual(duplicates[0].payment_id, payment.pk)
        self.assertEqual(duplicates[0].provider_txn_id, "TXN-2")

    def test_reconcile_is_idempotent(self) -> None:
        payment = self.pending_payment()
        self.provider_has(payment)

        first_run = self.reconcile()
        with tenant_context(self.tenant.id):
            entries = LedgerEntry.objects.count()
        second_run = self.reconcile()

        self.assertEqual(first_run, 1)
        self.assertEqual(second_run, 0)
        with tenant_context(self.tenant.id):
            self.assertEqual(LedgerEntry.objects.count(), entries)
            self.assertEqual(Receipt.objects.filter(payment=payment).count(), 1)
            self.assertFalse(GatewayReconciliationIssue.objects.exists())
        self.assertEqual(self.invoice_now().paid_total, Decimal("1000.00"))

    def test_one_event_failure_keeps_earlier_confirmations(self) -> None:
        first = self.pending_payment()
        second = self.pending_payment(invoice=self.second_invoice(), key="checkout-2")
        first_event = self.provider_has(first, txn="TXN-A")
        second_event = self.provider_has(second, txn="TXN-B")
        original = services._apply_gateway_event

        def apply(*, account, event, source):
            if event.order_id == second_event.order_id:
                raise RuntimeError("bad row")
            return original(account=account, event=event, source=source)

        with (
            mock.patch.object(
                self.adapter, "list_transactions", return_value=[first_event, second_event]
            ),
            mock.patch.object(services, "_apply_gateway_event", side_effect=apply),
            self.assertLogs("apps.fees_finance.services", level="ERROR"),
        ):
            applied = self.reconcile()

        self.assertEqual(applied, 1)
        self.assertEqual(self.reload(first).status, PaymentStatus.CONFIRMED)
        self.assertEqual(self.reload(second).status, PaymentStatus.PENDING)

    def test_one_tenants_gateway_outage_does_not_stop_others(self) -> None:
        payment = self.pending_payment()
        self.provider_has(payment)

        down = TenantFactory()
        enable_feature(down, ONLINE_FEATURE)
        down_credentials = {"merchant_id": "DOWN-000001", "secret": "down-school-secret"}
        down_account = make_account(down, self.user.pk, credentials=down_credentials)
        with tenant_context(down.id):
            down_invoice = FeeInvoiceFactory(
                tenant=down,
                student=StudentFactory(tenant=down, campus=CampusFactory(tenant=down)),
                academic_session=AcademicSessionFactory(tenant=down, is_current=True),
                invoice_no="INV-DOWN-1",
            )
            down_payment = Payment.objects.create(
                tenant=down,
                fee_invoice=down_invoice,
                student_id=down_invoice.student_id,
                amount=Decimal("250.00"),
                method=PaymentMethod.ONLINE_GATEWAY,
                reference_no="SH-INV-DOWN-1-0a0b0c0d",
                gateway_provider=down_account.provider,
                status=PaymentStatus.PENDING,
            )

        original = self.adapter.list_transactions

        def listing(credentials, day):
            if credentials["merchant_id"] == down_credentials["merchant_id"]:
                raise GatewayUnavailable("provider timed out")
            return original(credentials, day)

        with (
            mock.patch.object(self.adapter, "list_transactions", side_effect=listing),
            self.assertLogs("core.tenancy.maintenance", level="ERROR"),
        ):
            summary = tasks.reconcile_gateway_payments(day=self.day.isoformat())

        self.assertEqual(summary["failed"], 1)
        self.assertEqual(self.reload(payment).status, PaymentStatus.CONFIRMED)
        with tenant_context(down.id):
            down_payment.refresh_from_db()
        self.assertEqual(down_payment.status, PaymentStatus.PENDING)

    def test_accounts_without_payments_in_the_window_are_not_called(self) -> None:
        payment = self.pending_payment()
        self.age(payment, minutes=60 * 24 * 3)

        with mock.patch.object(self.adapter, "list_transactions") as listing:
            summary = tasks.reconcile_gateway_payments(day=self.day.isoformat())

        listing.assert_not_called()
        self.assertEqual(summary["failed"], 0)

    def test_default_day_is_yesterday(self) -> None:
        yesterday = timezone.now().date() - datetime.timedelta(days=1)
        with mock.patch.object(services, "reconcile_tenant_gateway_payments") as step:
            step.return_value = 0
            tasks.reconcile_gateway_payments()

        self.assertTrue(step.called)
        self.assertEqual({call.kwargs["day"] for call in step.call_args_list}, {yesterday})
