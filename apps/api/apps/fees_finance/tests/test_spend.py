"""Expenses and budgets — the spend side of §13.

The two rules worth reading twice are both about *when* money is recognised.
Approval posts to the ledger and payment does not, because §13's
income-vs-expense report should describe the period a school committed a cost
in rather than whenever the cheque cleared. And variance is computed from
posted entries rather than from expense rows, which is what makes a rejected or
reversed expense stop counting against a budget automatically.
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from apps.fees_finance import reports, services
from apps.fees_finance.models import (
    Expense,
    ExpenseStatus,
    LedgerEntry,
    LedgerReferenceType,
    PaymentMethod,
)
from apps.fees_finance.tests.base import FeesFinanceAPITestCase
from apps.fees_finance.tests.factories import (
    BudgetFactory,
    ExpenseCategoryFactory,
    ExpenseFactory,
    UserFactory,
    expense_account,
)
from core.api.exceptions import DomainRuleViolation
from core.tenancy.context import tenant_context


class SpendTestCase(FeesFinanceAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.expense_account = expense_account(self.tenant, code="5100", name="Utilities")
        with tenant_context(self.tenant.id):
            self.category = ExpenseCategoryFactory(
                tenant=self.tenant, ledger_account=self.expense_account
            )
        self.approver = UserFactory(tenant=self.tenant)

    def _expense(self, **kwargs) -> Expense:
        with tenant_context(self.tenant.id):
            return ExpenseFactory(
                tenant=self.tenant,
                expense_category=self.category,
                created_by=kwargs.pop("created_by", self.user.pk),
                payment_method=kwargs.pop("payment_method", PaymentMethod.BANK_TRANSFER),
                **kwargs,
            )


class ExpenseCategoryTests(SpendTestCase):
    def test_a_category_must_map_to_an_expense_account(self) -> None:
        """The mirror of the fee-head rule: spend filed against an income
        account makes the income statement wrong in a way that still balances."""
        with self.assertRaises(DomainRuleViolation):
            services.assert_expense_category_account_is_expense(ledger_account=self.fee_income)

    def test_an_expense_account_is_accepted(self) -> None:
        services.assert_expense_category_account_is_expense(ledger_account=self.expense_account)


class ExpenseApprovalTests(SpendTestCase):
    def test_a_draft_expense_posts_nothing(self) -> None:
        self._expense()

        with tenant_context(self.tenant.id):
            self.assertEqual(
                LedgerEntry.objects.filter(reference_type=LedgerReferenceType.EXPENSE).count(),
                0,
            )

    def test_approval_posts_the_gross_amount_to_the_ledger(self) -> None:
        """Tax rides on the same expense account: §19 leaves the tenant tax
        regime unconfirmed, and inventing an input-tax account for a school
        whose jurisdiction may not have one is a guess an auditor has to
        unpick."""
        expense = self._expense(amount=Decimal("5000.00"), tax_amount=Decimal("250.00"))

        with tenant_context(self.tenant.id):
            services.submit_expense(expense=expense, actor_id=self.user.pk)
            services.decide_expense(expense=expense, approve=True, actor_id=self.approver.pk)
            lines = list(
                LedgerEntry.objects.filter(
                    reference_type=LedgerReferenceType.EXPENSE, reference_id=expense.pk
                )
            )

        debit = next(line for line in lines if line.debit)
        credit = next(line for line in lines if line.credit)
        self.assertEqual(debit.ledger_account_id, self.expense_account.pk)
        self.assertEqual(debit.debit, Decimal("5250.00"))
        self.assertEqual(credit.ledger_account_id, self.bank.pk)
        self.assertEqual(credit.credit, Decimal("5250.00"))

    def test_the_submitter_cannot_approve_their_own_expense(self) -> None:
        """§15 says so outright, and the check is in `services` for the reason
        the refund one is: the rule has to hold through any door."""
        expense = self._expense()

        with tenant_context(self.tenant.id):
            services.submit_expense(expense=expense, actor_id=self.user.pk)

            with self.assertRaises(DomainRuleViolation) as caught:
                services.decide_expense(expense=expense, approve=True, actor_id=self.user.pk)

        self.assertIn("cannot approve", str(caught.exception.detail))

    def test_a_draft_expense_cannot_be_approved_without_being_submitted(self) -> None:
        expense = self._expense()

        with (
            tenant_context(self.tenant.id),
            self.assertRaises(DomainRuleViolation),
        ):
            services.decide_expense(expense=expense, approve=True, actor_id=self.approver.pk)

    def test_a_rejected_expense_posts_nothing(self) -> None:
        expense = self._expense()

        with tenant_context(self.tenant.id):
            services.submit_expense(expense=expense, actor_id=self.user.pk)
            rejected = services.decide_expense(
                expense=expense, approve=False, actor_id=self.approver.pk
            )
            postings = LedgerEntry.objects.filter(
                reference_type=LedgerReferenceType.EXPENSE, reference_id=expense.pk
            ).count()

        self.assertEqual(rejected.status, ExpenseStatus.REJECTED)
        self.assertEqual(postings, 0)

    def test_marking_paid_posts_nothing_further(self) -> None:
        """Approval already moved the money in the books; posting again would
        double-count it. The column exists so a school can tell committed from
        cleared."""
        expense = self._expense()

        with tenant_context(self.tenant.id):
            services.submit_expense(expense=expense, actor_id=self.user.pk)
            services.decide_expense(expense=expense, approve=True, actor_id=self.approver.pk)
            before = LedgerEntry.objects.count()
            paid = services.mark_expense_paid(expense=expense, actor_id=self.user.pk)
            after = LedgerEntry.objects.count()

        self.assertEqual(paid.status, ExpenseStatus.PAID)
        self.assertEqual(before, after)

    def test_only_an_approved_expense_can_be_paid(self) -> None:
        expense = self._expense()

        with (
            tenant_context(self.tenant.id),
            self.assertRaises(DomainRuleViolation),
        ):
            services.mark_expense_paid(expense=expense, actor_id=self.user.pk)

    def test_cash_credits_cash_and_a_transfer_credits_the_bank(self) -> None:
        cash_expense = self._expense(payment_method=PaymentMethod.CASH)

        with tenant_context(self.tenant.id):
            services.submit_expense(expense=cash_expense, actor_id=self.user.pk)
            services.decide_expense(expense=cash_expense, approve=True, actor_id=self.approver.pk)
            credit = LedgerEntry.objects.get(reference_id=cash_expense.pk, credit__gt=0)

        self.assertEqual(credit.ledger_account_id, self.cash.pk)


class BudgetTests(SpendTestCase):
    def test_a_budget_needs_exactly_one_target(self) -> None:
        """A budget against both an account and a category is double-counted by
        the variance report; one against neither describes nothing."""
        from django.db import IntegrityError, transaction

        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(IntegrityError),
        ):
            BudgetFactory(
                tenant=self.tenant,
                ledger_account=self.expense_account,
                expense_category=self.category,
            )

    def test_a_draft_budget_is_absent_from_the_variance_report(self) -> None:
        """A draft is a proposal. Reporting against one would show a school
        measuring itself against a figure nobody signed off."""
        with tenant_context(self.tenant.id):
            BudgetFactory(tenant=self.tenant, ledger_account=self.expense_account)
            from apps.fees_finance.models import Budget

            rows = reports.budget_variance(Budget.objects.alive())

        self.assertEqual(rows, [])

    def test_an_approved_budget_reports_its_variance_from_posted_entries(self) -> None:
        """The reason the ledger is the source of truth: a reversed or rejected
        expense stops counting automatically, where summing expense rows would
        need every report to know each document's lifecycle."""
        expense = self._expense(amount=Decimal("25000.00"))

        with tenant_context(self.tenant.id):
            services.submit_expense(expense=expense, actor_id=self.user.pk)
            services.decide_expense(expense=expense, approve=True, actor_id=self.approver.pk)
            budget = BudgetFactory(
                tenant=self.tenant,
                ledger_account=self.expense_account,
                amount=Decimal("100000.00"),
            )
            services.approve_budget(budget=budget, actor_id=self.approver.pk)

            from apps.fees_finance.models import Budget

            rows = reports.budget_variance(Budget.objects.alive(), as_of=datetime.date(2027, 3, 31))

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["budgeted"], Decimal("100000.00"))
        self.assertEqual(rows[0]["actual"], Decimal("25000.00"))
        self.assertEqual(rows[0]["variance"], Decimal("75000.00"))
        self.assertEqual(rows[0]["utilisation_percent"], Decimal("25.00"))

    def test_a_rejected_expense_does_not_count_against_a_budget(self) -> None:
        expense = self._expense(amount=Decimal("25000.00"))

        with tenant_context(self.tenant.id):
            services.submit_expense(expense=expense, actor_id=self.user.pk)
            services.decide_expense(expense=expense, approve=False, actor_id=self.approver.pk)
            budget = BudgetFactory(tenant=self.tenant, ledger_account=self.expense_account)
            services.approve_budget(budget=budget, actor_id=self.approver.pk)

            from apps.fees_finance.models import Budget

            rows = reports.budget_variance(Budget.objects.alive(), as_of=datetime.date(2027, 3, 31))

        self.assertEqual(rows[0]["actual"], Decimal("0.00"))

    def test_a_category_budget_resolves_through_its_account(self) -> None:
        """§15 allows either target, and both have to reach the same postings."""
        expense = self._expense(amount=Decimal("10000.00"))

        with tenant_context(self.tenant.id):
            services.submit_expense(expense=expense, actor_id=self.user.pk)
            services.decide_expense(expense=expense, approve=True, actor_id=self.approver.pk)
            budget = BudgetFactory(
                tenant=self.tenant,
                expense_category=self.category,
                amount=Decimal("50000.00"),
            )
            services.approve_budget(budget=budget, actor_id=self.approver.pk)

            from apps.fees_finance.models import Budget

            rows = reports.budget_variance(Budget.objects.alive(), as_of=datetime.date(2027, 3, 31))

        self.assertEqual(rows[0]["actual"], Decimal("10000.00"))

    def test_two_budgets_for_one_target_and_period_collide(self) -> None:
        """NULLS NOT DISTINCT: a tenant-wide budget has `campus_id IS NULL`, and
        two of those for one account is the double-count this exists to stop."""
        from django.db import IntegrityError, transaction

        with tenant_context(self.tenant.id):
            BudgetFactory(tenant=self.tenant, ledger_account=self.expense_account)

        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(IntegrityError),
        ):
            BudgetFactory(tenant=self.tenant, ledger_account=self.expense_account)

    def test_a_variance_report_is_a_bounded_number_of_queries(self) -> None:
        """Two queries — the budgets, then one aggregate over every account
        they name. One query per budget is the shape that makes a year-end
        review time out."""
        from apps.fees_finance.models import Budget

        with tenant_context(self.tenant.id):
            for index in range(6):
                account = expense_account(self.tenant, code=f"52{index:02d}")
                budget = BudgetFactory(tenant=self.tenant, ledger_account=account, name=f"B{index}")
                services.approve_budget(budget=budget, actor_id=self.approver.pk)

        with tenant_context(self.tenant.id), self.assertNumQueries(2):
            reports.budget_variance(Budget.objects.alive(), as_of=datetime.date(2027, 3, 31))
