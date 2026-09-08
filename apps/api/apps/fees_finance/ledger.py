"""The general ledger: the single write path to `ledger_entries`.

Every posting on the platform goes through `post_transaction`. Payments,
refunds, expenses and (later) payroll all call it, so there is exactly one place
that validates balance, refuses archived accounts and assigns a
`transaction_id`. Nothing else in this module — or any other — inserts into that
table; the model docstring says so too, and `LedgerEntry`'s append-only base
makes an accidental second write path fail loudly rather than quietly.

Two rules live here rather than in the database, both because a CHECK cannot see
a sibling row:

* **Balance.** Σ debit = Σ credit across the lines of one posting.
  `core.money.assert_balanced` holds it and names both sums when it refuses.
* **Archived accounts.** `is_active` is on the account row, not the entry.

Reads are aggregations in SQL, never a Python loop over entries. A year-end
trial balance over a school's postings is the query this module is most likely
to be asked for at the worst moment, and `assertNumQueries` in
`tests/test_ledger.py` is what keeps it one query.
"""

from __future__ import annotations

import datetime
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal

from django.db import connection, transaction

from apps.fees_finance.models import LedgerAccount, LedgerEntry, LedgerReferenceType
from core.api.exceptions import DomainRuleViolation
from core.money import ZERO, assert_balanced, quantize_money


@dataclass(frozen=True)
class LedgerLine:
    """One side of a posting, before it becomes a row.

    Frozen and query-free on purpose: a caller assembles a whole batch in
    memory, `post_transaction` validates the set once, and only then does
    anything touch the database. Amounts are quantized on the way in by
    `post_transaction`, so a caller may pass whatever precision its own
    arithmetic produced.
    """

    ledger_account_id: uuid.UUID
    debit: Decimal = ZERO
    credit: Decimal = ZERO
    memo: str | None = None


def _quantized(line: LedgerLine) -> LedgerLine:
    return LedgerLine(
        ledger_account_id=line.ledger_account_id,
        debit=quantize_money(line.debit),
        credit=quantize_money(line.credit),
        memo=line.memo,
    )


def assert_accounts_are_postable(
    account_ids: Sequence[uuid.UUID], *, allow_archived: bool = False
) -> dict[uuid.UUID, LedgerAccount]:
    """Return the accounts by id, refusing anything missing — and, usually, archived.

    One query for the whole set. Fetching per line is the N+1 that turns a
    payroll posting into a hundred round trips, and it is the reason this returns
    the map rather than a boolean.

    `allow_archived` exists for correcting history that already happened, not
    for a new posting — `reverse_transaction` and a partial refund's own
    mirrored posting are the two callers. Neither must be blocked by an
    account being archived *after* the original posting: a school archiving
    "Transport — 2025 fleet" at year end must not permanently strand a refund,
    full or partial, against a payment that posted there. Ordinary postings
    still refuse an archived account; only a correction of an account's own
    prior activity is exempt.
    """
    wanted = set(account_ids)
    accounts = {
        account.pk: account for account in LedgerAccount.objects.alive().filter(pk__in=wanted)
    }

    missing = wanted - set(accounts)
    if missing:
        raise DomainRuleViolation(
            "This posting references a ledger account that does not exist.",
            meta={"unknown_account_ids": sorted(str(pk) for pk in missing)},
        )

    if not allow_archived:
        archived = sorted(str(pk) for pk, account in accounts.items() if not account.is_active)
        if archived:
            raise DomainRuleViolation(
                "This posting references an archived ledger account. Archived accounts "
                "keep their history but accept no new postings.",
                meta={"archived_account_ids": archived},
            )
    return accounts


def post_transaction(
    *,
    entry_date: datetime.date,
    lines: Sequence[LedgerLine],
    reference_type: str,
    reference_id: uuid.UUID | None = None,
    actor_id: uuid.UUID | None = None,
    memo: str | None = None,
    allow_archived_accounts: bool = False,
) -> uuid.UUID:
    """Post one balanced transaction and return its `transaction_id`.

    Must run inside the caller's transaction, and asserts that rather than
    opening its own. A confirmed payment whose ledger posting rolled back
    separately is a reconciliation failure nobody discovers until year end, and
    by then the receipt has been given to a parent — so the posting and the
    thing that caused it commit together or neither does. This mirrors
    `core.tenancy.sequences.allocate_number`, which refuses for the same class
    of reason.

    `allow_archived_accounts` exists for `reverse_transaction` and a partial
    refund's own mirrored posting to pass through — see
    `assert_accounts_are_postable`'s docstring. Every ordinary caller leaves it
    at the default.
    """
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError(
            "post_transaction() must run inside the same transaction as the record "
            "it posts for — a payment with no ledger entry is unreconcilable. "
            "Wrap the caller in transaction.atomic()."
        )

    quantized = [_quantized(line) for line in lines]
    assert_balanced(quantized)
    assert_accounts_are_postable(
        [line.ledger_account_id for line in quantized], allow_archived=allow_archived_accounts
    )

    transaction_id = uuid.uuid4()
    LedgerEntry.objects.bulk_create(
        [
            LedgerEntry(
                tenant_id=_current_tenant_id(),
                transaction_id=transaction_id,
                entry_date=entry_date,
                ledger_account_id=line.ledger_account_id,
                debit=line.debit,
                credit=line.credit,
                reference_type=reference_type,
                reference_id=reference_id,
                memo=line.memo or memo,
                created_by=actor_id,
            )
            for line in quantized
        ]
    )
    return transaction_id


def reverse_transaction(
    *,
    transaction_id: uuid.UUID,
    entry_date: datetime.date,
    actor_id: uuid.UUID | None = None,
    memo: str | None = None,
) -> uuid.UUID:
    """Post the mirror image of `transaction_id` and stamp the originals.

    This is what "correction" means on an append-only ledger: the original lines
    stay exactly as posted, a new transaction moves the same amounts the other
    way, and each original records which transaction superseded it. Nothing is
    edited except `reversed_by_transaction_id`, which is the single column the
    table's grant leaves updatable.

    Reversing twice is refused rather than made idempotent. A posting already
    superseded means the caller's model of the books is wrong, and quietly
    doing nothing would let a double refund look successful.
    """
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError(
            "reverse_transaction() must run inside the caller's transaction. "
            "Wrap the caller in transaction.atomic()."
        )

    originals = list(LedgerEntry.objects.filter(transaction_id=transaction_id).select_for_update())
    if not originals:
        raise DomainRuleViolation(
            "There is no such ledger transaction to reverse.",
            meta={"transaction_id": str(transaction_id)},
        )

    already = [entry for entry in originals if entry.reversed_by_transaction_id]
    if already:
        raise DomainRuleViolation(
            "This ledger transaction has already been reversed.",
            meta={
                "transaction_id": str(transaction_id),
                "reversed_by_transaction_id": str(already[0].reversed_by_transaction_id),
            },
        )

    reversal_id = post_transaction(
        entry_date=entry_date,
        # Debit and credit swap. The reversal is a posting in its own right and
        # is validated as one, so a set that balanced forwards balances back.
        lines=[
            LedgerLine(
                ledger_account_id=entry.ledger_account_id,
                debit=entry.credit,
                credit=entry.debit,
                memo=memo or f"Reversal of {transaction_id}",
            )
            for entry in originals
        ],
        reference_type=LedgerReferenceType.REVERSAL,
        reference_id=transaction_id,
        actor_id=actor_id,
        memo=memo,
        # A reversal corrects history that already happened; it must not be
        # blocked by an account having been archived since the original
        # posting, or an archived account permanently strands every refund
        # against a payment that posted there.
        allow_archived_accounts=True,
    )

    # One statement for every original line, not one `save()` each — a
    # multi-line posting (payments split across several income heads) would
    # otherwise cost a round trip per line just to stamp the same reversal id.
    # `AppendOnlyQuerySet.update()` refuses on principle, and rightly so: it
    # would let a caller silently rewrite every column, not just this one. A
    # raw statement naming only `reversed_by_transaction_id` is the same
    # column-level grant `save(update_fields=[...])` uses, exercised once for
    # the whole set instead of once per row; RLS still scopes it, since
    # `originals` was already read through the tenant-scoped manager.
    with connection.cursor() as cursor:
        cursor.execute(
            "UPDATE ledger_entries SET reversed_by_transaction_id = %s WHERE id = ANY(%s::uuid[])",
            [str(reversal_id), [str(entry.pk) for entry in originals]],
        )

    return reversal_id


def trial_balance(
    *, date_from: datetime.date, date_to: datetime.date, include_zero: bool = False
) -> list[dict]:
    """Per-account debit/credit totals over a period — §13's report 6.

    Aggregated in the database. A Python loop over a year of a school's entries
    would return the same answer and time out on the school that most needs it,
    which is why `tests/test_ledger.py` asserts the query count and not just the
    figures.
    """
    from django.db.models import DecimalField, Sum, Value
    from django.db.models.functions import Coalesce

    zero = Value(ZERO, output_field=DecimalField(max_digits=12, decimal_places=2))
    rows = (
        LedgerEntry.objects.filter(entry_date__gte=date_from, entry_date__lte=date_to)
        .values(
            "ledger_account_id",
            "ledger_account__code",
            "ledger_account__name",
            "ledger_account__account_type",
        )
        .annotate(
            total_debit=Coalesce(Sum("debit"), zero),
            total_credit=Coalesce(Sum("credit"), zero),
        )
        .order_by("ledger_account__code")
    )

    balances = [
        {
            "ledger_account_id": str(row["ledger_account_id"]),
            "code": row["ledger_account__code"],
            "name": row["ledger_account__name"],
            "account_type": row["ledger_account__account_type"],
            "total_debit": row["total_debit"],
            "total_credit": row["total_credit"],
            "balance": quantize_money(row["total_debit"] - row["total_credit"]),
        }
        for row in rows
    ]
    if include_zero:
        return balances
    return [row for row in balances if row["total_debit"] or row["total_credit"]]


def _current_tenant_id() -> uuid.UUID:
    """The bound tenant, or a loud failure.

    `bulk_create` bypasses the tenant-scoped manager's filtering — it is an
    INSERT, not a SELECT — so the tenant has to be set explicitly on each row.
    Reading it here rather than taking it as a parameter keeps every caller from
    having to thread it, and failing closed matches `TenantScopedManager`:
    unbound means refuse, never mean "all".
    """
    from core.tenancy.context import get_current_tenant_id

    tenant_id = get_current_tenant_id()
    if tenant_id is None:
        raise RuntimeError(
            "post_transaction() ran with no bound tenant. RLS would refuse the "
            "insert anyway; failing here names the cause."
        )
    return tenant_id
