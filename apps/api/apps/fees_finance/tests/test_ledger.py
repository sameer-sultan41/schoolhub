"""The ledger: double-entry balance, and the append-only guarantee itself.

This file is where AGENTS.md invariant 4 is proved. The interesting half is not
that the Python guards raise — it is that they are **not the boundary**. A
queryset `.update()` never calls `save()`, and a raw cursor never touches the
ORM at all. The cases below reach past each layer in turn and assert the
database refuses anyway, connected as `schoolhub_app` (NOSUPERUSER,
NOBYPASSRLS), which is the role CI and production both use.

That matters because a ledger the application can rewrite is not a ledger. The
same argument `core/audit`'s immutability migration makes about an audit trail
applies with more force to money, and it is the one invariant that cannot be
retrofitted once a tenant has transactions.
"""

from __future__ import annotations

import datetime
import uuid
from decimal import Decimal

from django.db import ProgrammingError, connection, transaction
from django.test import TestCase, TransactionTestCase

from apps.fees_finance.ledger import (
    LedgerLine,
    post_transaction,
    reverse_transaction,
    trial_balance,
)
from apps.fees_finance.models import LedgerAccountType, LedgerEntry, LedgerReferenceType
from apps.fees_finance.services import ensure_system_accounts
from apps.fees_finance.tests.factories import LedgerAccountFactory, TenantFactory, posting
from core.api.exceptions import DomainRuleViolation
from core.tenancy.context import tenant_atomic, tenant_context


class LedgerTestCase(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        with tenant_context(self.tenant.id), transaction.atomic():
            self.accounts = ensure_system_accounts(tenant_id=self.tenant.pk)
        self.cash = self.accounts["1000"]
        self.fee_income = self.accounts["4000"]

    def _post(self, **kwargs):
        return posting(
            self.tenant, debit_account=self.cash, credit_account=self.fee_income, **kwargs
        )


class PostingRuleTests(LedgerTestCase):
    def test_a_posting_whose_debits_do_not_equal_its_credits_is_refused(self) -> None:
        """§11. A service rule, not a constraint: balance is a property of the
        *set* of lines sharing a transaction_id, and a CHECK cannot see a
        sibling row."""
        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(DomainRuleViolation) as caught,
        ):
            post_transaction(
                entry_date=datetime.date(2026, 9, 1),
                lines=[
                    LedgerLine(ledger_account_id=self.cash.pk, debit=Decimal("100.00")),
                    LedgerLine(ledger_account_id=self.fee_income.pk, credit=Decimal("90.00")),
                ],
                reference_type=LedgerReferenceType.MANUAL,
            )

        # The figures, not just "unbalanced" — a job log at 2am needs the numbers.
        self.assertEqual(caught.exception.meta["difference"], "10.00")
        self.assertEqual(LedgerEntry.all_tenants.count(), 0)

    def test_a_posting_of_zero_is_refused(self) -> None:
        """It balances and moves nothing, which is a caller bug rather than a
        no-op worth committing."""
        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(DomainRuleViolation),
        ):
            post_transaction(
                entry_date=datetime.date(2026, 9, 1),
                lines=[
                    LedgerLine(ledger_account_id=self.cash.pk, debit=Decimal("0.00")),
                    LedgerLine(ledger_account_id=self.fee_income.pk, credit=Decimal("0.00")),
                ],
                reference_type=LedgerReferenceType.MANUAL,
            )

    def test_a_posting_to_an_archived_account_is_refused(self) -> None:
        """`is_active` is on the account row, so this too cannot be a constraint
        on the entry."""
        with tenant_context(self.tenant.id):
            archived = LedgerAccountFactory(
                tenant=self.tenant,
                code="4900",
                account_type=LedgerAccountType.INCOME,
                is_active=False,
            )

        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(DomainRuleViolation) as caught,
        ):
            post_transaction(
                entry_date=datetime.date(2026, 9, 1),
                lines=[
                    LedgerLine(ledger_account_id=self.cash.pk, debit=Decimal("50.00")),
                    LedgerLine(ledger_account_id=archived.pk, credit=Decimal("50.00")),
                ],
                reference_type=LedgerReferenceType.MANUAL,
            )

        self.assertIn(str(archived.pk), caught.exception.meta["archived_account_ids"])

    def test_a_posting_to_an_unknown_account_names_it(self) -> None:
        unknown = uuid.uuid4()
        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(DomainRuleViolation) as caught,
        ):
            post_transaction(
                entry_date=datetime.date(2026, 9, 1),
                lines=[
                    LedgerLine(ledger_account_id=self.cash.pk, debit=Decimal("50.00")),
                    LedgerLine(ledger_account_id=unknown, credit=Decimal("50.00")),
                ],
                reference_type=LedgerReferenceType.MANUAL,
            )

        self.assertEqual(caught.exception.meta["unknown_account_ids"], [str(unknown)])

    def test_a_balanced_posting_lands_both_lines_under_one_transaction_id(self) -> None:
        transaction_id = self._post(amount=Decimal("250.00"))

        with tenant_context(self.tenant.id):
            lines = list(LedgerEntry.objects.filter(transaction_id=transaction_id))

        self.assertEqual(len(lines), 2)
        self.assertEqual(sorted(str(line.debit) for line in lines), ["0.00", "250.00"])

    def test_amounts_are_quantized_to_two_places_on_the_way_in(self) -> None:
        """The column is numeric(12,2). Quantizing here rather than letting the
        database round is what keeps a total equal to the sum of its lines."""
        with tenant_context(self.tenant.id), transaction.atomic():
            transaction_id = post_transaction(
                entry_date=datetime.date(2026, 9, 1),
                lines=[
                    LedgerLine(ledger_account_id=self.cash.pk, debit=Decimal("10.125")),
                    LedgerLine(ledger_account_id=self.fee_income.pk, credit=Decimal("10.125")),
                ],
                reference_type=LedgerReferenceType.MANUAL,
            )
            debit = (
                LedgerEntry.objects.filter(transaction_id=transaction_id)
                .exclude(debit=0)
                .get()
                .debit
            )

        # ROUND_HALF_UP, so .125 goes up — the arithmetic a person doing it by
        # hand would produce, not banker's rounding.
        self.assertEqual(debit, Decimal("10.13"))


class AppendOnlyTests(LedgerTestCase):
    """Each case reaches one layer deeper than the last."""

    def _raw(self, sql: str) -> None:
        """Run `sql` on a raw cursor inside its own atomic block.

        Extracted so each caller can put `assertRaises` *outside* it. A
        permission denial poisons the transaction, and if `assertRaises`
        swallowed the error while still inside `atomic`, the block would exit
        cleanly and then fail releasing its savepoint on a dead connection — an
        `InFailedSqlTransaction` instead of the assertion the test is for.
        """
        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute(sql)

    def test_an_entry_cannot_be_saved_twice_through_the_model(self) -> None:
        """Layer 1: the instance path. A full save() rewrites every column."""
        transaction_id = self._post()
        with tenant_context(self.tenant.id):
            entry = LedgerEntry.objects.filter(transaction_id=transaction_id).first()
            entry.memo = "tampered"

            with self.assertRaises(RuntimeError) as caught:
                entry.save()

        self.assertIn("append-only", str(caught.exception))

    def test_an_entry_cannot_be_deleted_through_the_model(self) -> None:
        transaction_id = self._post()
        with tenant_context(self.tenant.id):
            entry = LedgerEntry.objects.filter(transaction_id=transaction_id).first()

            with self.assertRaises(RuntimeError) as caught:
                entry.delete()

        self.assertIn("cannot be deleted", str(caught.exception))

    def test_a_queryset_update_is_refused_before_it_reaches_the_database(self) -> None:
        """Layer 2: the bulk path, which never calls save() at all.

        This is the hole the audit log's own migration docstring names. The
        queryset refuses with a message naming the reversal route, which is a
        better developer experience than PostgreSQL's bare "permission denied".
        """
        self._post()
        with tenant_context(self.tenant.id), self.assertRaises(RuntimeError) as caught:
            LedgerEntry.objects.update(memo="tampered")

        self.assertIn("append-only", str(caught.exception))

    def test_a_queryset_delete_is_refused(self) -> None:
        self._post()
        with tenant_context(self.tenant.id), self.assertRaises(RuntimeError):
            LedgerEntry.objects.delete()

    def test_a_queryset_bulk_update_is_refused(self) -> None:
        """`bulk_update()` builds its own UPDATE independently of `update()` —
        a separate code path in the ORM, and so a separate hole unless it gets
        its own override."""
        self._post()
        with tenant_context(self.tenant.id):
            entry = LedgerEntry.objects.first()
            entry.memo = "tampered"

            with self.assertRaises(RuntimeError) as caught:
                LedgerEntry.objects.bulk_update([entry], ["memo"])

        self.assertIn("append-only", str(caught.exception))

    def test_raw_sql_update_is_refused_by_the_database_itself(self) -> None:
        """Layer 3: the only one that matters.

        A raw cursor bypasses every Python guard above. Connected as
        `schoolhub_app` — NOSUPERUSER, NOBYPASSRLS — so the revoked grant is
        what refuses, not the ORM. Without this case the whole design rests on
        code paths remembering to be careful.
        """
        self._post()
        with tenant_context(self.tenant.id), self.assertRaises(ProgrammingError) as caught:
            self._raw("UPDATE ledger_entries SET memo = 'tampered'")

        self.assertIn("permission denied", str(caught.exception).lower())

    def test_raw_sql_delete_is_refused_by_the_database_itself(self) -> None:
        self._post()
        with tenant_context(self.tenant.id), self.assertRaises(ProgrammingError) as caught:
            self._raw("DELETE FROM ledger_entries")

        self.assertIn("permission denied", str(caught.exception).lower())

    def test_a_tenant_scoped_bulk_delete_is_refused_like_the_unscoped_one(self) -> None:
        """The shape a cascade would take, past all three the class docstring names.

        Nothing on this platform actually deletes a `Tenant` row today
        (retirement is `TenantStatus.DEPROVISIONED`, a status, not a row
        deletion) — but *if* something ever cascaded a tenant's deletion
        through Django's ORM, the collector would emit a `DELETE FROM
        ledger_entries WHERE tenant_id = ...`, which is a raw statement through
        the connection that the model's own `delete()` guard and
        `AppendOnlyQuerySet.delete()` never see. This proves the actual
        boundary holds even for that shape: the `schoolhub_app` connection has
        DELETE revoked on `ledger_entries` at the database, so a tenant-scoped
        bulk delete is refused exactly like the unscoped one above, regardless
        of which code path constructs it.
        """
        self._post()

        # `assertRaises` outside `atomic()`, not inside — see `_raw`'s
        # docstring above. A permission denial poisons the transaction, and if
        # `assertRaises` swallowed it while still inside `atomic`, the block
        # would exit cleanly and then fail releasing its savepoint on a dead
        # connection instead of raising the assertion the test is for.
        with (
            tenant_context(self.tenant.id),
            self.assertRaises(ProgrammingError) as caught,
            transaction.atomic(),
            connection.cursor() as cursor,
        ):
            cursor.execute("DELETE FROM ledger_entries WHERE tenant_id = %s", [str(self.tenant.pk)])

        self.assertIn("permission denied", str(caught.exception).lower())

    def test_the_one_mutable_column_may_be_updated_and_nothing_else(self) -> None:
        """The column-level GRANT UPDATE, which is what makes reversal possible
        on a table that otherwise refuses every write."""
        transaction_id = self._post()
        reversal_id = uuid.uuid4()

        with tenant_context(self.tenant.id):
            entry = LedgerEntry.objects.filter(transaction_id=transaction_id).first()
            entry.reversed_by_transaction_id = reversal_id
            entry.save(update_fields=["reversed_by_transaction_id"])

            entry.refresh_from_db()
            self.assertEqual(entry.reversed_by_transaction_id, reversal_id)

            # A narrowed save() outside the allowance is still refused, so the
            # allowance is a whitelist rather than an escape hatch.
            entry.memo = "tampered"
            with self.assertRaises(RuntimeError):
                entry.save(update_fields=["memo"])


class ReversalTests(LedgerTestCase):
    def test_stamping_the_originals_is_one_statement_regardless_of_line_count(self) -> None:
        """A multi-line posting — a payment split across several income heads —
        must not cost a round trip per line just to stamp the same reversal id
        on each. Asserted against the SQL actually issued: a query count that
        does not grow with the number of lines is what proves it, not the
        figures alone.
        """
        from django.test.utils import CaptureQueriesContext

        second_income = LedgerAccountFactory(
            tenant=self.tenant, code="4900", account_type=LedgerAccountType.INCOME
        )
        with tenant_context(self.tenant.id), transaction.atomic():
            transaction_id = post_transaction(
                entry_date=datetime.date(2026, 9, 1),
                lines=[
                    LedgerLine(ledger_account_id=self.cash.pk, debit=Decimal("300.00")),
                    LedgerLine(ledger_account_id=self.fee_income.pk, credit=Decimal("100.00")),
                    LedgerLine(ledger_account_id=second_income.pk, credit=Decimal("200.00")),
                ],
                reference_type=LedgerReferenceType.MANUAL,
            )

        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            CaptureQueriesContext(connection) as queries,
        ):
            reverse_transaction(transaction_id=transaction_id, entry_date=datetime.date(2026, 9, 5))

        updates = [
            q["sql"]
            for q in queries.captured_queries
            if q["sql"].strip().upper().startswith("UPDATE") and "ledger_entries" in q["sql"]
        ]
        self.assertEqual(len(updates), 1, updates)

    def test_a_reversal_mirrors_the_original_and_stamps_it(self) -> None:
        original = self._post(amount=Decimal("400.00"))

        with tenant_context(self.tenant.id), transaction.atomic():
            reversal = reverse_transaction(
                transaction_id=original, entry_date=datetime.date(2026, 9, 5)
            )

        with tenant_context(self.tenant.id):
            originals = list(LedgerEntry.objects.filter(transaction_id=original))
            mirrored = list(LedgerEntry.objects.filter(transaction_id=reversal))

        self.assertTrue(all(e.reversed_by_transaction_id == reversal for e in originals))
        self.assertEqual(len(mirrored), 2)
        self.assertTrue(all(e.reference_type == LedgerReferenceType.REVERSAL for e in mirrored))
        # The original debit is now a credit of the same amount, so the two
        # transactions together net to nothing.
        original_debit = next(e for e in originals if e.debit)
        mirror_credit = next(e for e in mirrored if e.credit)
        self.assertEqual(original_debit.ledger_account_id, mirror_credit.ledger_account_id)
        self.assertEqual(original_debit.debit, mirror_credit.credit)

    def test_the_original_lines_are_not_edited_only_stamped(self) -> None:
        """The point of a reversal: history stays exactly as posted."""
        original = self._post(amount=Decimal("400.00"))
        with tenant_context(self.tenant.id):
            before = {
                (str(e.debit), str(e.credit), e.memo)
                for e in LedgerEntry.objects.filter(transaction_id=original)
            }

        with tenant_context(self.tenant.id), transaction.atomic():
            reverse_transaction(transaction_id=original, entry_date=datetime.date(2026, 9, 5))

        with tenant_context(self.tenant.id):
            after = {
                (str(e.debit), str(e.credit), e.memo)
                for e in LedgerEntry.objects.filter(transaction_id=original)
            }

        self.assertEqual(before, after)

    def test_reversing_twice_is_refused_rather_than_made_idempotent(self) -> None:
        """Quietly doing nothing would let a double refund look successful."""
        original = self._post()
        with tenant_context(self.tenant.id), transaction.atomic():
            reverse_transaction(transaction_id=original, entry_date=datetime.date(2026, 9, 5))

        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(DomainRuleViolation) as caught,
        ):
            reverse_transaction(transaction_id=original, entry_date=datetime.date(2026, 9, 6))

        self.assertIn("already been reversed", str(caught.exception.detail))

    def test_reversing_something_that_does_not_exist_is_refused(self) -> None:
        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(DomainRuleViolation),
        ):
            reverse_transaction(transaction_id=uuid.uuid4(), entry_date=datetime.date(2026, 9, 5))


class TrialBalanceTests(LedgerTestCase):
    def test_a_trial_balance_nets_debits_against_credits_per_account(self) -> None:
        self._post(amount=Decimal("100.00"))
        self._post(amount=Decimal("250.00"))

        with tenant_context(self.tenant.id):
            rows = {
                row["code"]: row
                for row in trial_balance(
                    date_from=datetime.date(2026, 1, 1), date_to=datetime.date(2026, 12, 31)
                )
            }

        self.assertEqual(rows["1000"]["total_debit"], Decimal("350.00"))
        self.assertEqual(rows["1000"]["balance"], Decimal("350.00"))
        self.assertEqual(rows["4000"]["total_credit"], Decimal("350.00"))
        self.assertEqual(rows["4000"]["balance"], Decimal("-350.00"))

    def test_accounts_with_no_activity_are_omitted_unless_asked_for(self) -> None:
        self._post()
        with tenant_context(self.tenant.id):
            default = trial_balance(
                date_from=datetime.date(2026, 1, 1), date_to=datetime.date(2026, 12, 31)
            )

        self.assertEqual({row["code"] for row in default}, {"1000", "4000"})

    def test_a_trial_balance_is_one_query_regardless_of_how_many_entries(self) -> None:
        """Aggregated in the database. A Python loop over a year of a school's
        postings would return the same answer and time out on the school that
        most needs it, so only a query count catches the regression.
        """
        for _ in range(12):
            self._post(amount=Decimal("100.00"))

        with tenant_context(self.tenant.id), self.assertNumQueries(1):
            trial_balance(date_from=datetime.date(2026, 1, 1), date_to=datetime.date(2026, 12, 31))

    def test_a_posting_outside_the_period_is_excluded(self) -> None:
        self._post(amount=Decimal("100.00"), entry_date=datetime.date(2026, 3, 1))
        self._post(amount=Decimal("500.00"), entry_date=datetime.date(2027, 3, 1))

        with tenant_context(self.tenant.id):
            rows = {
                row["code"]: row
                for row in trial_balance(
                    date_from=datetime.date(2026, 1, 1), date_to=datetime.date(2026, 12, 31)
                )
            }

        self.assertEqual(rows["1000"]["total_debit"], Decimal("100.00"))


class TransactionGuardTests(TransactionTestCase):
    """`post_transaction` refuses to run outside the caller's transaction.

    A `TransactionTestCase`, and it has to be: `TestCase` wraps every method in
    a transaction, so `in_atomic_block` is always true there and the guard could
    never fire — a case that can only pass is worse than no case at all.

    The rule itself is the one `core.tenancy.sequences.allocate_number` states:
    a confirmed payment whose ledger posting rolled back separately is
    unreconcilable, and by then the receipt is in a parent's hand. So the engine
    refuses rather than quietly opening its own transaction, which would defeat
    the guarantee while looking like it worked.
    """

    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        # `tenant_atomic`, not `tenant_context` + `atomic`. Outside an already
        # open transaction — which is exactly where a TransactionTestCase runs —
        # `set_database_tenant`'s `SET LOCAL` has no transaction to attach to
        # and is lost, and the INSERT is then refused by the RLS policy rather
        # than by anything this test is about. `tenant_atomic` opens the
        # transaction first, which is what it exists for.
        with tenant_atomic(self.tenant.id):
            self.accounts = ensure_system_accounts(tenant_id=self.tenant.pk)

    def test_posting_outside_a_transaction_is_refused(self) -> None:
        with tenant_context(self.tenant.id), self.assertRaises(RuntimeError) as caught:
            post_transaction(
                entry_date=datetime.date(2026, 9, 1),
                lines=[
                    LedgerLine(ledger_account_id=self.accounts["1000"].pk, debit=Decimal("10.00")),
                    LedgerLine(ledger_account_id=self.accounts["4000"].pk, credit=Decimal("10.00")),
                ],
                reference_type=LedgerReferenceType.MANUAL,
            )

        self.assertIn("same transaction", str(caught.exception))

    def test_reversing_outside_a_transaction_is_refused(self) -> None:
        with tenant_context(self.tenant.id), self.assertRaises(RuntimeError) as caught:
            reverse_transaction(transaction_id=uuid.uuid4(), entry_date=datetime.date(2026, 9, 1))

        self.assertIn("caller's transaction", str(caught.exception))
