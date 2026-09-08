"""Cross-tenant access on every fees-finance endpoint.

testing-strategy.md §3 and AGENTS.md invariant 2: for each endpoint, a tenant-A
caller reaching for a tenant-B resource must get **404, never 403** — a 403
confirms the row exists, which is the leak the rule exists to prevent.

The acting user holds every key this module declares, `all`-scoped, and the flag
is on for both tenants, so a denial here can only come from tenant scoping.
Without that these would pass for the wrong reason the moment someone forgot a
permission.

Two shapes fail differently from a plain detail lookup, and both are asserted:

- **A body-referenced id** — `POST /fee-schedules` names its structure and head
  in the body. A foreign id fails to resolve through the serializer's
  tenant-scoped `PrimaryKeyRelatedField`, which is a **400**: the field
  genuinely does not validate. That leaks nothing, because the message says the
  id is invalid, not that it belongs to someone else.
- **`:post-journal`** names its accounts in the body too, and a foreign account
  is refused by `ledger.assert_accounts_are_postable` as *unknown* — the
  tenant-scoped manager cannot see it, so from this caller's side it does not
  exist. Which is the correct thing to say.

Because the money tables are where a leak would matter most, this file also
proves the isolation is the *database's* rather than the manager's, by reading
`ledger_entries` through `all_tenants` — the manager that does no filtering at
all — and asserting the row still does not come back.
"""

from __future__ import annotations

from decimal import Decimal

from django.utils import timezone
from rest_framework import status

from apps.fees_finance import services
from apps.fees_finance.models import LedgerEntry, PaymentStatus, Receipt
from apps.fees_finance.services import ensure_system_accounts
from apps.fees_finance.tests.base import FEATURE, FeesFinanceAPITestCase
from apps.fees_finance.tests.factories import (
    AcademicSessionFactory,
    BudgetFactory,
    CampusFactory,
    DiscountFactory,
    ExpenseCategoryFactory,
    ExpenseFactory,
    FeeHeadFactory,
    FeeInvoiceFactory,
    FeeScheduleFactory,
    FeeStructureFactory,
    FeeVoucherFactory,
    FineFactory,
    LedgerAccountFactory,
    PaymentFactory,
    ScholarshipFactory,
    StudentFactory,
    TenantFactory,
    enable_feature,
    fine_head,
    posting,
)
from core.tenancy.context import tenant_context


class FinanceCrossTenantTests(FeesFinanceAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        from django.db import transaction

        self.other_tenant = TenantFactory()
        enable_feature(self.other_tenant, FEATURE)

        with tenant_context(self.other_tenant.id):
            with transaction.atomic():
                other_accounts = ensure_system_accounts(tenant_id=self.other_tenant.pk)
            self.other_income = other_accounts["4000"]
            self.other_cash = other_accounts["1000"]
            self.other_session = AcademicSessionFactory(tenant=self.other_tenant, is_current=True)
            self.other_head = FeeHeadFactory(
                tenant=self.other_tenant, ledger_account=self.other_income
            )
            self.other_structure = FeeStructureFactory(
                tenant=self.other_tenant, academic_session=self.other_session
            )
            self.other_schedule = FeeScheduleFactory(
                tenant=self.other_tenant,
                fee_structure=self.other_structure,
                fee_head=self.other_head,
            )
            self.other_extra_account = LedgerAccountFactory(tenant=self.other_tenant, code="4321")
            other_campus = CampusFactory(tenant=self.other_tenant)
            self.other_student = StudentFactory(tenant=self.other_tenant, campus=other_campus)
            self.other_invoice = FeeInvoiceFactory(
                tenant=self.other_tenant,
                student=self.other_student,
                academic_session=self.other_session,
                invoice_no="INV-OTHER-1",
            )
            self.other_discount = DiscountFactory(
                tenant=self.other_tenant,
                student=self.other_student,
                academic_session=self.other_session,
            )
            self.other_scholarship = ScholarshipFactory(
                tenant=self.other_tenant,
                student=self.other_student,
                academic_session=self.other_session,
            )
            self.other_fine = FineFactory(
                tenant=self.other_tenant,
                student=self.other_student,
                fee_head=fine_head(self.other_tenant, self.other_income),
            )
            self.other_payment = PaymentFactory(
                tenant=self.other_tenant,
                fee_invoice=self.other_invoice,
                student=self.other_student,
                status=PaymentStatus.CONFIRMED,
                paid_at=timezone.now(),
            )
            self.other_receipt = Receipt.objects.create(
                tenant=self.other_tenant,
                payment=self.other_payment,
                receipt_no="RCP-OTHER-1",
                amount=self.other_payment.amount,
            )
            self.other_voucher = FeeVoucherFactory(
                tenant=self.other_tenant,
                fee_invoice=self.other_invoice,
                student=self.other_student,
            )
            other_expense_account = LedgerAccountFactory(
                tenant=self.other_tenant, code="5900", account_type="expense"
            )
            self.other_category = ExpenseCategoryFactory(
                tenant=self.other_tenant, ledger_account=other_expense_account
            )
            self.other_expense = ExpenseFactory(
                tenant=self.other_tenant, expense_category=self.other_category
            )
            self.other_budget = BudgetFactory(
                tenant=self.other_tenant, ledger_account=other_expense_account
            )

    def test_a_foreign_ledger_account_is_not_found(self) -> None:
        response = self.client.get(f"/api/v1/ledger-accounts/{self.other_extra_account.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_foreign_fee_head_is_not_found(self) -> None:
        response = self.client.get(f"/api/v1/fee-heads/{self.other_head.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_foreign_fee_structure_is_not_found(self) -> None:
        response = self.client.get(f"/api/v1/fee-structures/{self.other_structure.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_foreign_fee_schedule_is_not_found(self) -> None:
        response = self.client.get(f"/api/v1/fee-schedules/{self.other_schedule.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_activating_a_foreign_structure_is_not_found(self) -> None:
        response = self.client.post(f"/api/v1/fee-structures/{self.other_structure.pk}:activate")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_archiving_a_foreign_structure_is_not_found(self) -> None:
        response = self.client.post(f"/api/v1/fee-structures/{self.other_structure.pk}:archive")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_deleting_a_foreign_fee_head_is_not_found(self) -> None:
        response = self.client.delete(f"/api/v1/fee-heads/{self.other_head.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_foreign_structure_named_in_a_body_does_not_validate(self) -> None:
        response = self.client.post(
            "/api/v1/fee-schedules",
            {
                "fee_structure": str(self.other_structure.pk),
                "fee_head": str(self.other_head.pk),
                "amount": "100.00",
                "frequency": "monthly",
                "due_day": 5,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_foreign_ledger_account_cannot_be_posted_to(self) -> None:
        """Refused as *unknown* rather than as forbidden, which is the honest
        answer: the tenant-scoped manager cannot see it, so from this caller's
        side it does not exist."""
        response = self.client.post(
            "/api/v1/ledger-entries:post-journal",
            {
                "entry_date": "2026-09-01",
                "memo": "Cross-tenant attempt",
                "lines": [
                    {"ledger_account": str(self.cash.pk), "debit": "10.00"},
                    {"ledger_account": str(self.other_income.pk), "credit": "10.00"},
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn(
            str(self.other_income.pk),
            response.json()["error"]["meta"]["unknown_account_ids"],
        )
        with tenant_context(self.tenant.id):
            self.assertEqual(LedgerEntry.objects.count(), 0)

    def test_a_foreign_account_cannot_be_made_a_parent(self) -> None:
        response = self.client.post(
            "/api/v1/ledger-accounts",
            {
                "code": "4002",
                "name": "Grafted",
                "account_type": "income",
                "parent": str(self.other_income.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_foreign_tenant_s_ledger_entries_are_never_listed(self) -> None:
        posting(
            self.other_tenant,
            debit_account=self.other_cash,
            credit_account=self.other_income,
            amount=Decimal("999.00"),
        )

        response = self.client.get("/api/v1/ledger-entries")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["data"], [])

    def test_the_database_hides_a_foreign_posting_not_just_the_manager(self) -> None:
        """Read through `all_tenants`, which does no tenant filtering at all.

        Money is where a leak would be worst, so this asserts the *database* is
        the boundary — the same thing `tests/test_rls_enforcement.py` does for
        `school_organization`, repeated here because a new base class
        (`AppendOnlyTenantModel`) is carrying the policy for the first time and
        "it inherited the right thing" is worth proving rather than assuming.
        """
        posting(
            self.other_tenant,
            debit_account=self.other_cash,
            credit_account=self.other_income,
        )

        with tenant_context(self.tenant.id):
            self.assertEqual(LedgerEntry.all_tenants.count(), 0)

    # ------------------------------------------------------------- invoicing

    def test_a_foreign_invoice_is_not_found(self) -> None:
        response = self.client.get(f"/api/v1/fee-invoices/{self.other_invoice.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_foreign_discount_is_not_found(self) -> None:
        response = self.client.get(f"/api/v1/discounts/{self.other_discount.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_foreign_scholarship_is_not_found(self) -> None:
        response = self.client.get(f"/api/v1/scholarships/{self.other_scholarship.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_foreign_fine_is_not_found(self) -> None:
        response = self.client.get(f"/api/v1/fines/{self.other_fine.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cancelling_a_foreign_invoice_is_not_found(self) -> None:
        response = self.client.post(
            f"/api/v1/fee-invoices/{self.other_invoice.pk}:cancel",
            {"reason": "Not mine to cancel"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_revoking_a_foreign_discount_is_not_found(self) -> None:
        response = self.client.post(
            f"/api/v1/discounts/{self.other_discount.pk}:revoke",
            {"reason": "Not mine to revoke"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_waiving_a_foreign_fine_is_not_found(self) -> None:
        response = self.client.post(
            f"/api/v1/fines/{self.other_fine.pk}:waive",
            {"reason": "Not mine to waive"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_billing_a_foreign_structure_is_not_found(self) -> None:
        """The structure is named in the *body*, and `:generate` resolves it
        through the tenant-scoped manager — so this is a 404 from the lookup
        rather than a 400 from a field, and it leaks nothing either way."""
        response = self.client.post(
            "/api/v1/fee-invoices:generate",
            {"fee_structure": str(self.other_structure.pk), "period_start": "2026-09-01"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_foreign_student_cannot_be_fined(self) -> None:
        """A student named in a body fails to resolve through the serializer's
        tenant-scoped PrimaryKeyRelatedField, which is a 400: the field
        genuinely does not validate, and the message says the id is invalid
        rather than that it belongs to someone else."""
        head = fine_head(self.tenant, self.fee_income)

        response = self.client.post(
            "/api/v1/fines",
            {
                "student": str(self.other_student.pk),
                "fee_head": str(head.pk),
                "fine_type": "library",
                "amount": "100.00",
                "reason": "Cross-tenant attempt",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_foreign_tenant_s_invoices_are_never_listed(self) -> None:
        response = self.client.get("/api/v1/fee-invoices")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["data"], [])

    # ------------------------------------------------------------- collection

    def test_a_foreign_payment_is_not_found(self) -> None:
        response = self.client.get(f"/api/v1/payments/{self.other_payment.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_foreign_receipt_is_not_found(self) -> None:
        response = self.client.get(f"/api/v1/receipts/{self.other_receipt.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_foreign_voucher_is_not_found(self) -> None:
        response = self.client.get(f"/api/v1/vouchers/{self.other_voucher.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_downloading_a_foreign_receipt_is_not_found(self) -> None:
        """The PDF route matters more than the JSON one: it renders a document
        carrying a family's name and what they paid."""
        response = self.client.get(f"/api/v1/receipts/{self.other_receipt.pk}/download")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_downloading_a_foreign_voucher_is_not_found(self) -> None:
        response = self.client.get(f"/api/v1/vouchers/{self.other_voucher.pk}/download")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_paying_a_foreign_invoice_is_not_found(self) -> None:
        response = self.client.post(
            "/api/v1/payments:record",
            {
                "fee_invoice": str(self.other_invoice.pk),
                "amount": "100.00",
                "method": "cash",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_issuing_a_voucher_on_a_foreign_invoice_is_not_found(self) -> None:
        response = self.client.post(
            f"/api/v1/fee-invoices/{self.other_invoice.pk}/vouchers",
            {"provider": "bank_branch"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_voiding_a_foreign_voucher_is_not_found(self) -> None:
        response = self.client.post(
            f"/api/v1/vouchers/{self.other_voucher.pk}:void",
            {"reason": "Not mine to void"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_settlement_file_never_matches_another_tenant_s_voucher(self) -> None:
        """The matcher reads vouchers through the tenant-scoped manager, so a
        consumer number belonging to another school simply does not exist —
        which is the correct answer and lands the row in exceptions.
        """
        from apps.fees_finance.adapters import adapter_for
        from apps.fees_finance.models import Payment, VoucherCollectionImport
        from apps.fees_finance.tests.factories import settlement_csv
        from core.files.services import create_ready_file

        with tenant_context(self.tenant.id):
            stored = create_ready_file(
                tenant_id=self.tenant.pk,
                purpose="fees.settlement-file",
                original_name="settlement.csv",
                mime_type="text/csv",
                data=b"x",
                actor_id=self.user.pk,
            )
            record = VoucherCollectionImport.objects.create(
                tenant=self.tenant,
                provider="bank_branch",
                file=stored,
                imported_by=self.user.pk,
            )
            rows = (
                adapter_for("bank_branch")
                .parse(
                    settlement_csv(
                        [(self.other_voucher.consumer_number, "TRX-X", "1000.00", "2026-09-05")]
                    )
                )
                .rows
            )
            result = services.apply_settlement_rows(
                voucher_import=record,
                rows=rows,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )
            self.assertEqual(Payment.objects.count(), 0)

        self.assertEqual(result["matched"], 0)
        self.assertEqual(result["exceptions"], 1)

    # ---------------------------------------------------- spend and reports

    def test_a_foreign_expense_is_not_found(self) -> None:
        response = self.client.get(f"/api/v1/expenses/{self.other_expense.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_foreign_expense_category_is_not_found(self) -> None:
        response = self.client.get(f"/api/v1/expense-categories/{self.other_category.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_foreign_budget_is_not_found(self) -> None:
        response = self.client.get(f"/api/v1/budgets/{self.other_budget.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_approving_a_foreign_expense_is_not_found(self) -> None:
        response = self.client.post(f"/api/v1/expenses/{self.other_expense.pk}:approve")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_approving_a_foreign_budget_is_not_found(self) -> None:
        response = self.client.post(f"/api/v1/budgets/{self.other_budget.pk}:approve")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_no_report_includes_another_tenant_s_figures(self) -> None:
        """The case that matters most in this file.

        A report is read as authoritative, so a leak here is a school seeing
        another school's books. Every kind is walked rather than a
        representative one, because `build_report_rows` applies scope per kind
        and one missed branch is one leaking report.
        """
        for kind in (
            "collection",
            "outstanding-aging",
            "expense-register",
            "grant-register",
            "budget-variance",
        ):
            with self.subTest(kind=kind):
                response = self.client.get(
                    f"/api/v1/reports/finance-summary?kind={kind}"
                    "&date_from=2026-01-01&date_to=2027-12-31"
                )
                self.assertEqual(response.status_code, status.HTTP_200_OK)
                self.assertEqual(response.json()["data"], [])

    def test_a_foreign_student_s_ledger_is_empty_rather_than_theirs(self) -> None:
        response = self.client.get(f"/api/v1/students/{self.other_student.pk}/ledger")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["data"], [])
