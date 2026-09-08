"""The constraints, asserted against a real PostgreSQL.

Each case names the rule it pins rather than the column it touches. Every
uniqueness rule in this module is scoped to live rows, so a soft-deleted
predecessor never blocks its replacement — which is what makes "archive the
structure and clone it" a workable correction rather than a dead end.

`ledger_entries` is the exception and has its own file: it is append-only, so
its rules are about what *cannot* happen to a row after it exists, which needs
the real database role rather than a constraint check. See test_ledger.py.
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from apps.fees_finance.models import FeeFrequency, LedgerAccountType
from apps.fees_finance.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    FeeHeadFactory,
    FeeScheduleFactory,
    FeeStructureFactory,
    LedgerAccountFactory,
    TenantFactory,
    TermFactory,
    income_account,
)
from core.tenancy.context import tenant_context


class FinanceModelTestCase(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.session = AcademicSessionFactory(tenant=self.tenant, is_current=True)
            self.term = TermFactory(tenant=self.tenant, academic_session=self.session, sequence=1)
            self.school_class = ClassFactory(tenant=self.tenant, level=8)
        self.income = income_account(self.tenant)

    def assertRefused(self, build, **kwargs) -> None:
        """Assert `build(**kwargs)` violates a database constraint.

        A savepoint per case, because an IntegrityError poisons the surrounding
        transaction and `TestCase` wraps the whole method in one — without it
        the *next* assertion in the same test fails for the wrong reason.
        """
        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(IntegrityError),
        ):
            build(**kwargs)


class LedgerAccountConstraintTests(FinanceModelTestCase):
    def test_two_accounts_cannot_share_a_code(self) -> None:
        with tenant_context(self.tenant.id):
            LedgerAccountFactory(tenant=self.tenant, code="7777")

        self.assertRefused(LedgerAccountFactory, tenant=self.tenant, code="7777")

    def test_a_soft_deleted_account_does_not_block_its_replacement(self) -> None:
        """Retiring a code and reusing it is legitimate; the partial unique has
        to ignore the row that is on its way out."""
        with tenant_context(self.tenant.id):
            outgoing = LedgerAccountFactory(tenant=self.tenant, code="7778")
            outgoing.deleted_at = timezone.now()
            outgoing.save(update_fields=["deleted_at"])

            replacement = LedgerAccountFactory(tenant=self.tenant, code="7778")

        self.assertEqual(replacement.code, "7778")

    def test_a_system_account_cannot_be_soft_deleted(self) -> None:
        """One soft delete would orphan every fee head mapped to the account and
        every posting already made against it, so the database refuses rather
        than relying on nobody trying."""
        with tenant_context(self.tenant.id):
            account = LedgerAccountFactory(tenant=self.tenant, code="7779", is_system=True)

        def soft_delete():
            account.deleted_at = timezone.now()
            account.save(update_fields=["deleted_at"])

        self.assertRefused(soft_delete)

    def test_a_non_system_account_may_be_soft_deleted(self) -> None:
        """The control: the constraint must not stop an ordinary account going."""
        with tenant_context(self.tenant.id):
            account = LedgerAccountFactory(tenant=self.tenant, code="7780", is_system=False)
            account.deleted_at = timezone.now()
            account.save(update_fields=["deleted_at"])

        self.assertIsNotNone(account.deleted_at)


class FeeHeadConstraintTests(FinanceModelTestCase):
    def test_two_heads_cannot_share_a_code(self) -> None:
        with tenant_context(self.tenant.id):
            FeeHeadFactory(tenant=self.tenant, code="TUITION", ledger_account=self.income)

        self.assertRefused(
            FeeHeadFactory, tenant=self.tenant, code="TUITION", ledger_account=self.income
        )

    def test_a_head_may_map_to_any_account_type_at_the_database(self) -> None:
        """The income-account rule is a *service* rule, and this pins that split.

        `account_type` lives on `ledger_accounts`, so a CHECK on `fee_heads`
        cannot read it — `services.assert_fee_head_account_is_income` is what
        refuses, and test_api.py asserts the 422. This case exists so the split
        is deliberate rather than an oversight someone later "fixes" by adding a
        constraint that cannot work.
        """
        with tenant_context(self.tenant.id):
            asset = LedgerAccountFactory(
                tenant=self.tenant, code="1500", account_type=LedgerAccountType.ASSET
            )
            head = FeeHeadFactory(tenant=self.tenant, code="ODD", ledger_account=asset)

        self.assertEqual(head.ledger_account_id, asset.pk)


class FeeStructureConstraintTests(FinanceModelTestCase):
    def _structure(self, **kwargs):
        return FeeStructureFactory(tenant=self.tenant, academic_session=self.session, **kwargs)

    def test_two_structures_cannot_share_a_name_at_the_same_scope(self) -> None:
        with tenant_context(self.tenant.id):
            self._structure(name="Grade 8 — 2026-27", school_class=self.school_class)

        self.assertRefused(
            self._structure, name="Grade 8 — 2026-27", school_class=self.school_class
        )

    def test_two_session_wide_structures_cannot_share_a_name_either(self) -> None:
        """The case NULLS NOT DISTINCT exists for.

        `class_id` and `campus_id` NULL both mean "all", so they have to be a
        value that collides with itself. Under PostgreSQL's default a unique
        index treats every NULL as distinct, which would have made every
        session-wide structure unique from every other and this guard a no-op
        for the broadest scope a school can define.
        """
        with tenant_context(self.tenant.id):
            self._structure(name="Whole school", school_class=None, campus=None)

        self.assertRefused(self._structure, name="Whole school", school_class=None, campus=None)

    def test_the_same_name_for_a_different_class_is_fine(self) -> None:
        """Scope is part of the key: two classes priced separately is the normal
        case, not a collision."""
        with tenant_context(self.tenant.id):
            self._structure(name="Standard", school_class=self.school_class)
            other = ClassFactory(tenant=self.tenant, level=3)

            structure = self._structure(name="Standard", school_class=other)

        self.assertEqual(structure.name, "Standard")

    def test_a_session_wide_structure_needs_no_class_or_campus(self) -> None:
        """Null means "all", which is what makes one structure serve a school."""
        with tenant_context(self.tenant.id):
            structure = self._structure(name="Whole school", school_class=None, campus=None)

        self.assertIsNone(structure.school_class_id)
        self.assertIsNone(structure.campus_id)


class FeeScheduleConstraintTests(FinanceModelTestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.structure = FeeStructureFactory(tenant=self.tenant, academic_session=self.session)
            self.head = FeeHeadFactory(tenant=self.tenant, ledger_account=self.income)

    def _schedule(self, **kwargs):
        return FeeScheduleFactory(
            tenant=self.tenant, fee_structure=self.structure, fee_head=self.head, **kwargs
        )

    def test_one_line_per_structure_head_frequency_and_term(self) -> None:
        """The common case, and the one NULLS NOT DISTINCT rescues.

        `term` is NULL on every non-per-term line, so under PostgreSQL's default
        a structure could carry the same monthly charge twice — and bill it
        twice, every month, to a whole class.
        """
        with tenant_context(self.tenant.id):
            self._schedule()

        self.assertRefused(self._schedule)

    def test_the_same_head_at_a_different_frequency_is_a_separate_line(self) -> None:
        """The control: an annual registration charge alongside a monthly
        tuition charge on the same head is legitimate."""
        with tenant_context(self.tenant.id):
            self._schedule()
            annual = self._schedule(
                frequency=FeeFrequency.ANNUAL,
                due_day=None,
                due_date=datetime.date(2027, 4, 1),
            )

        self.assertEqual(annual.frequency, FeeFrequency.ANNUAL)

    def test_a_zero_amount_is_refused(self) -> None:
        """A schedule charging nothing is either a configuration error or a
        reason not to have the line."""
        self.assertRefused(self._schedule, amount=Decimal("0.00"))

    def test_a_per_term_line_without_a_term_is_refused(self) -> None:
        self.assertRefused(self._schedule, frequency=FeeFrequency.PER_TERM, term=None, due_day=None)

    def test_a_monthly_line_carrying_a_term_is_refused(self) -> None:
        """Scoping error: the same charge would be billed in every term."""
        self.assertRefused(self._schedule, frequency=FeeFrequency.MONTHLY, term=self.term)

    def test_a_monthly_line_without_a_due_day_is_refused(self) -> None:
        """An invoice with no due date silently exempts a class from both the
        aging report and the reminder sweep."""
        self.assertRefused(self._schedule, frequency=FeeFrequency.MONTHLY, due_day=None)

    def test_a_due_day_beyond_the_shortest_month_is_refused(self) -> None:
        """Day 29-31 is not a rule February can honour. Constrained to 1-28 so
        the generator's clamp is a rare path rather than the normal one."""
        self.assertRefused(self._schedule, frequency=FeeFrequency.MONTHLY, due_day=31)

    def test_an_annual_line_without_a_due_date_is_refused(self) -> None:
        self.assertRefused(
            self._schedule, frequency=FeeFrequency.ANNUAL, due_day=None, due_date=None
        )

    def test_an_annual_line_with_a_due_date_is_accepted(self) -> None:
        with tenant_context(self.tenant.id):
            schedule = self._schedule(
                frequency=FeeFrequency.ANNUAL,
                due_day=None,
                due_date=datetime.date(2027, 4, 1),
            )

        self.assertEqual(schedule.due_date, datetime.date(2027, 4, 1))

    def test_a_per_term_line_with_its_term_is_accepted(self) -> None:
        with tenant_context(self.tenant.id):
            schedule = self._schedule(frequency=FeeFrequency.PER_TERM, term=self.term, due_day=None)

        self.assertEqual(schedule.term_id, self.term.pk)
