"""§12's invoice-issued fan-out: one `notify()` call per invoice, not per batch.

The case this file exists for is the batch-notification leak a review found:
`_notify_issued` and `_send_batch` used to share one `notify()` call — and one
rendered body — across every invoice in a run. `notify()` renders its template
exactly once from the single `context` it is given and persists that identical
body to every recipient in the call, so sharing one call across many families
meant every family but the first read a notice naming someone else's child,
invoice number and amount. The fix groups by student instead; these tests prove
two families in one run each get their own, correctly addressed notice.
"""

from __future__ import annotations

from decimal import Decimal

from apps.fees_finance import tasks
from apps.fees_finance.tests.base import FeesFinanceAPITestCase
from apps.fees_finance.tests.factories import (
    FeeHeadFactory,
    FeeInvoiceFactory,
    FeeInvoiceLineFactory,
    GuardianFactory,
    StudentGuardianFactory,
    UserFactory,
)
from core.notifications.models import Notification
from core.tenancy.context import tenant_context


class InvoiceIssuedNotificationTests(FeesFinanceAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.head = FeeHeadFactory(tenant=self.tenant, ledger_account=self.fee_income)

            # A second family, distinct from the guardian `base.py` already
            # wires to `self.students[0]`.
            self.second_guardian_user = UserFactory(tenant=self.tenant)
            self.second_guardian = GuardianFactory(
                tenant=self.tenant, user_id=self.second_guardian_user.pk
            )
            StudentGuardianFactory(
                tenant=self.tenant,
                student=self.students[1],
                guardian=self.second_guardian,
                has_portal_access=True,
            )

            self.first_invoice = FeeInvoiceFactory(
                tenant=self.tenant,
                student=self.students[0],
                academic_session=self.session,
                subtotal=Decimal("1000.00"),
                invoice_no="INV-FAM-1",
                period_label="2026-09",
            )
            FeeInvoiceLineFactory(
                tenant=self.tenant,
                fee_invoice=self.first_invoice,
                fee_head=self.head,
                amount=Decimal("1000.00"),
            )
            self.second_invoice = FeeInvoiceFactory(
                tenant=self.tenant,
                student=self.students[1],
                academic_session=self.session,
                subtotal=Decimal("2000.00"),
                invoice_no="INV-FAM-2",
                period_label="2026-09",
            )
            FeeInvoiceLineFactory(
                tenant=self.tenant,
                fee_invoice=self.second_invoice,
                fee_head=self.head,
                amount=Decimal("2000.00"),
            )

    def test_two_families_in_one_run_each_get_their_own_notice(self) -> None:
        notified = tasks._notify_issued(
            tenant_id=self.tenant.pk,
            invoice_ids=[str(self.first_invoice.pk), str(self.second_invoice.pk)],
        )

        with tenant_context(self.tenant.id):
            first_notice = Notification.objects.get(
                user_id=self.guardian_user.pk, source_id=self.first_invoice.pk
            )
            second_notice = Notification.objects.get(
                user_id=self.second_guardian_user.pk, source_id=self.second_invoice.pk
            )

        self.assertEqual(notified, 2)
        self.assertIn(self.students[0].first_name, first_notice.body)
        self.assertIn("INV-FAM-1", first_notice.title)
        self.assertIn("1000.00", first_notice.body)
        self.assertNotIn(self.students[1].first_name, first_notice.body)
        self.assertNotIn("INV-FAM-2", first_notice.title)

        self.assertIn(self.students[1].first_name, second_notice.body)
        self.assertIn("INV-FAM-2", second_notice.title)
        self.assertIn("2000.00", second_notice.body)
        self.assertNotIn(self.students[0].first_name, second_notice.body)
        self.assertNotIn("INV-FAM-1", second_notice.title)

    def test_a_family_receives_no_other_family_s_notification(self) -> None:
        """The negative of the above, asserted directly: exactly one notice
        reaches each guardian, not the other family's."""
        tasks._notify_issued(
            tenant_id=self.tenant.pk,
            invoice_ids=[str(self.first_invoice.pk), str(self.second_invoice.pk)],
        )

        with tenant_context(self.tenant.id):
            first_family_notices = Notification.objects.filter(user_id=self.guardian_user.pk)
            second_family_notices = Notification.objects.filter(
                user_id=self.second_guardian_user.pk
            )

        self.assertEqual(first_family_notices.count(), 1)
        self.assertEqual(second_family_notices.count(), 1)
        self.assertEqual(first_family_notices.get().source_id, self.first_invoice.pk)
        self.assertEqual(second_family_notices.get().source_id, self.second_invoice.pk)


class ReminderBatchNotificationTests(FeesFinanceAPITestCase):
    """The same fan-out fix on `_send_batch`'s side — the due-reminder and
    overdue sweep, which had the same bug: one `notify()` call for the whole
    batch, with an `outstanding` total summed across every family in it."""

    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.head = FeeHeadFactory(tenant=self.tenant, ledger_account=self.fee_income)

            self.second_guardian_user = UserFactory(tenant=self.tenant)
            self.second_guardian = GuardianFactory(
                tenant=self.tenant, user_id=self.second_guardian_user.pk
            )
            StudentGuardianFactory(
                tenant=self.tenant,
                student=self.students[1],
                guardian=self.second_guardian,
                has_portal_access=True,
            )

            self.first_invoice = FeeInvoiceFactory(
                tenant=self.tenant,
                student=self.students[0],
                academic_session=self.session,
                subtotal=Decimal("300.00"),
                invoice_no="INV-DUE-1",
                period_label="2026-09",
            )
            FeeInvoiceLineFactory(
                tenant=self.tenant,
                fee_invoice=self.first_invoice,
                fee_head=self.head,
                amount=Decimal("300.00"),
            )
            self.second_invoice = FeeInvoiceFactory(
                tenant=self.tenant,
                student=self.students[1],
                academic_session=self.session,
                subtotal=Decimal("700.00"),
                invoice_no="INV-DUE-2",
                period_label="2026-09",
            )
            FeeInvoiceLineFactory(
                tenant=self.tenant,
                fee_invoice=self.second_invoice,
                fee_head=self.head,
                amount=Decimal("700.00"),
            )

    def test_each_family_s_reminder_names_only_their_own_balance(self) -> None:
        from apps.fees_finance import notifications
        from core.notifications.services import notify

        with tenant_context(self.tenant.id):
            notified = tasks._send_batch(
                tenant=self.tenant,
                invoices=[self.first_invoice, self.second_invoice],
                event=notifications.DUE_REMINDER,
                notify=notify,
            )
            first_notice = Notification.objects.get(
                user_id=self.guardian_user.pk, source_id=self.first_invoice.pk
            )
            second_notice = Notification.objects.get(
                user_id=self.second_guardian_user.pk, source_id=self.second_invoice.pk
            )

        self.assertEqual(notified, 2)
        # Each family's own balance, not the two invoices' combined 1000.00 —
        # the exact figure the old shared-context version would have shown.
        self.assertIn("300.00", first_notice.body)
        self.assertNotIn("1000.00", first_notice.body)
        self.assertIn("700.00", second_notice.body)
        self.assertNotIn("1000.00", second_notice.body)
