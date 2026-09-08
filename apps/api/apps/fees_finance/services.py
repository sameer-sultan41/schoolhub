"""Business rules for the fees-finance module.

Views, tasks and management commands all call this; nothing here knows about
HTTP. The rules that could not be constraints live here with the reason stated
at each one — mostly because they span rows (double-entry balance, structure
scope overlap) or read a column on another table (a fee head's account type).

Ledger postings are not here: they are in `ledger.py`, which is the single write
path to `ledger_entries`.
"""

from __future__ import annotations

import datetime
import uuid
from collections.abc import Sequence

from django.db import transaction

from apps.fees_finance.ledger import LedgerLine, post_transaction
from apps.fees_finance.models import (
    FeeHead,
    FeeSchedule,
    FeeStructure,
    FeeStructureStatus,
    LedgerAccount,
    LedgerAccountType,
    LedgerEntry,
    LedgerReferenceType,
)
from core.api.exceptions import DomainRuleViolation

#: The chart of accounts a tenant cannot operate without — §6's "system accounts
#: seeded at provisioning". Deliberately minimal: these are the accounts this
#: module's own postings need, not a full accounting template. A school's
#: accountant adds their own alongside them, and `is_system` is what stops one of
#: these being deleted out from under a fee head that maps to it.
#:
#: The codes follow the conventional numeric blocks (1000 assets, 2000
#: liabilities, 4000 income, 5000 expenses) so an accountant importing their own
#: chart has somewhere obvious to slot it in.
SYSTEM_ACCOUNTS: tuple[tuple[str, str, str], ...] = (
    ("1000", "Cash", LedgerAccountType.ASSET),
    ("1010", "Bank", LedgerAccountType.ASSET),
    ("1100", "Fees receivable", LedgerAccountType.ASSET),
    ("2000", "Fees received in advance", LedgerAccountType.LIABILITY),
    ("4000", "Fee income", LedgerAccountType.INCOME),
    ("4100", "Fine income", LedgerAccountType.INCOME),
    ("5000", "General expenses", LedgerAccountType.EXPENSE),
)


def ensure_system_accounts(*, tenant_id: uuid.UUID) -> dict[str, LedgerAccount]:
    """Create this tenant's system accounts if absent; return all of them by code.

    Idempotent on `(tenant, code)`, which the partial unique index enforces, so
    re-running it after adding a new entry to `SYSTEM_ACCOUNTS` backfills only
    the new one. Not a `post_migrate` hook: migrations run once per deploy and
    tenants are created long afterwards, so there is no moment at migrate time
    when the tenant list is known. Called by `seed_finance_accounts`, by the dev
    and e2e seeders, and by the test base.

    An existing account is left exactly as found — a school that renamed "Cash"
    to "Petty cash" keeps its name, and one that archived an account it does not
    use keeps it archived. Re-asserting our defaults over a tenant's edits would
    make this command destructive on its second run.

    Reads through `all_tenants.filter(tenant_id=tenant_id)`, not the default
    manager. `LedgerAccount.objects` is tenant-scoped by the *ambient* context
    (`core.tenancy.context.get_current_tenant_id()`), not by this function's own
    `tenant_id` argument — every current caller happens to bind that context
    first, so the two agree today, but a function that takes `tenant_id`
    explicitly should not depend on a caller having also set it as ambient
    state. Getting it wrong here is silent and severe: if the two ever diverge,
    `existing` reflects the *other* tenant's accounts, every code in
    `SYSTEM_ACCOUNTS` looks already present (the codes are fixed strings like
    "1000"), and this tenant's accounts are never created.
    """
    existing = {
        account.code: account
        for account in LedgerAccount.all_tenants.filter(tenant_id=tenant_id).alive()
    }
    missing = [
        LedgerAccount(
            tenant_id=tenant_id, code=code, name=name, account_type=account_type, is_system=True
        )
        for code, name, account_type in SYSTEM_ACCOUNTS
        if code not in existing
    ]
    if missing:
        LedgerAccount.objects.bulk_create(missing)
        existing.update({account.code: account for account in missing})
    return existing


def assert_fee_head_account_is_income(*, ledger_account: LedgerAccount) -> None:
    """§15 — a fee head maps to an *income* account.

    Not a CHECK constraint: `account_type` lives on `ledger_accounts`, and a
    constraint on `fee_heads` cannot read it. Caught here rather than at
    collection time, because a fee mapped to an asset account produces receipts
    that balance and an income statement that is wrong — the kind of error an
    accountant finds months later while closing the year.
    """
    if ledger_account.account_type != LedgerAccountType.INCOME:
        raise DomainRuleViolation(
            {
                "ledger_account": (
                    f"A fee head must map to an income account. "
                    f"{ledger_account.code} {ledger_account.name} is "
                    f"{ledger_account.get_account_type_display().lower()}."
                )
            }
        )


def assert_account_may_be_archived(*, account: LedgerAccount) -> None:
    """A system account stays available; anything else may be archived freely.

    Archiving keeps the row and its code exactly as they are — only
    `is_active` moves — so a posted-to account's history stays reachable under
    the same code. `is_system` accounts are the ones this module's own
    postings target by code, so archiving one would break collection for the
    whole tenant. This check is for `PATCH is_active=False` only; deleting is
    the stricter operation and has its own check below.
    """
    if account.is_system:
        raise DomainRuleViolation(
            {
                "is_active": (
                    f"{account.code} {account.name} is a system account and stays "
                    "available. Add your own account alongside it instead."
                )
            }
        )


def assert_account_may_be_deleted(*, account: LedgerAccount) -> None:
    """Deletion is stricter than archiving: nothing may have posted to it.

    Archiving keeps the row and its code; deleting frees the code for reuse —
    `ledger_accounts_code_unique` is conditioned on `deleted_at IS NULL`. An
    account with live postings must never be deletable, because a new account
    could then take its code while the old postings still exist under a
    now-invisible row: the FK still resolves correctly by primary key, but
    "account 4001" would silently mean two different things depending on when
    you asked. Archiving is the only retirement path once anything has posted;
    say so rather than letting the delete succeed and the confusion surface
    later, in a report.
    """
    assert_account_may_be_archived(account=account)
    if LedgerEntry.objects.filter(ledger_account=account).exists():
        raise DomainRuleViolation(
            {
                "id": (
                    f"{account.code} {account.name} has ledger postings and cannot "
                    "be deleted. Archive it instead — its code stays reserved and "
                    "its history stays under it."
                )
            }
        )


def assert_structure_is_editable(*, structure: FeeStructure) -> None:
    """Only a draft structure's lines may change.

    Once a structure is `active`, invoices have been priced from it, and an
    edited schedule would silently disagree with every invoice already issued.
    §6's answer is to archive it and clone — which is why the clone convenience
    exists at all.
    """
    if structure.status != FeeStructureStatus.DRAFT:
        raise DomainRuleViolation(
            {
                "fee_structure": (
                    f"This structure is {structure.get_status_display().lower()} and its "
                    "lines are fixed. Invoices have been priced from it. Clone it and "
                    "edit the copy."
                )
            }
        )


def assert_session_is_writable(*, academic_session) -> None:
    """A closed session takes no new fee configuration.

    The predicate mirrors `academics` and `examinations` — `AcademicSession.
    is_writable` is school-organization's own, and this defers to it rather
    than restating the status list. The function itself is not shared: the
    error body's key and wording are fees-finance's own ("fee configuration"),
    where examinations' equivalent speaks to exams. Genuinely unifying the two
    into one helper is a cross-module change with no bug behind it, so it is
    left as a parallel, independent implementation of the same underlying rule
    rather than bundled into this PR.
    """
    if not academic_session.is_writable:
        raise DomainRuleViolation(
            {
                "academic_session": (
                    f"{academic_session.name} is "
                    f"{academic_session.get_status_display().lower()} and takes no new "
                    "fee configuration."
                )
            }
        )


@transaction.atomic
def activate_fee_structure(*, structure: FeeStructure, actor_id: uuid.UUID | None) -> FeeStructure:
    """Move a structure from draft to active, refusing an unusable one.

    Two rules, both of which can only be checked as a set:

    * **It must have at least one schedule.** An active structure with no lines
      generates invoices with no charges — a whole class silently billed
      nothing, which nobody notices until the term's collection report.
    * **No other active structure may already cover the same scope.** Two active
      structures for the same session, class and campus make "which price
      applies?" ambiguous, and invoice generation would have to guess. The
      unique index cannot express this: it includes `name`, deliberately, so
      that two *differently named* structures at one scope are a database-legal
      state this check is what refuses.
    """
    locked = FeeStructure.objects.select_for_update().get(pk=structure.pk)

    if not FeeSchedule.objects.alive().filter(fee_structure=locked).exists():
        raise DomainRuleViolation(
            {"status": "This structure has no fee schedules, so it would charge nothing."}
        )

    clash = (
        FeeStructure.objects.alive()
        .filter(
            academic_session_id=locked.academic_session_id,
            school_class_id=locked.school_class_id,
            campus_id=locked.campus_id,
            status=FeeStructureStatus.ACTIVE,
        )
        .exclude(pk=locked.pk)
        .first()
    )
    if clash is not None:
        raise DomainRuleViolation(
            {
                "status": (
                    f"'{clash.name}' is already the active structure for this session, "
                    "class and campus. Archive it first."
                )
            },
            meta={"conflicting_structure_id": str(clash.pk)},
        )

    locked.status = FeeStructureStatus.ACTIVE
    locked.updated_by = actor_id
    locked.save(update_fields=["status", "updated_by", "updated_at"])
    return locked


@transaction.atomic
def archive_fee_structure(*, structure: FeeStructure, actor_id: uuid.UUID | None) -> FeeStructure:
    """Retire a structure. Invoices already priced from it are untouched."""
    locked = FeeStructure.objects.select_for_update().get(pk=structure.pk)
    locked.status = FeeStructureStatus.ARCHIVED
    locked.updated_by = actor_id
    locked.save(update_fields=["status", "updated_by", "updated_at"])
    return locked


def assert_fee_head_is_unused(*, fee_head: FeeHead) -> None:
    """A head priced into a schedule cannot be deleted, only deactivated.

    `is_active=False` removes it from new structures while every historical
    invoice line keeps its meaning. Deleting it would leave lines describing a
    charge nobody can name.
    """
    if FeeSchedule.objects.alive().filter(fee_head=fee_head).exists():
        raise DomainRuleViolation(
            {
                "fee_head": (
                    "This fee head is priced into a fee schedule. Deactivate it "
                    "instead — historical invoice lines still refer to it."
                )
            }
        )


@transaction.atomic
def post_manual_journal(
    *,
    entry_date: datetime.date,
    lines: Sequence[LedgerLine],
    memo: str,
    actor_id: uuid.UUID | None,
) -> uuid.UUID:
    """An accountant's hand-written journal entry — §8's accountant journey.

    The one posting with no platform record behind it, which is exactly why
    `reference_type` is `manual` and `memo` is required rather than optional: a
    trial-balance line an auditor cannot trace to either an automatic origin or
    a stated reason is the line that costs a school its audit.
    """
    if not memo.strip():
        raise DomainRuleViolation({"memo": "A manual journal entry must say why it was posted."})
    return post_transaction(
        entry_date=entry_date,
        lines=lines,
        reference_type=LedgerReferenceType.MANUAL,
        reference_id=None,
        actor_id=actor_id,
        memo=memo,
    )
