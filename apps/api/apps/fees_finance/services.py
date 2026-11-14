"""Business rules for the fees-finance module.

Views, tasks and management commands all call this; nothing here knows about
HTTP. The rules that could not be constraints live here with the reason stated
at each one — mostly because they span rows (double-entry balance, structure
scope overlap) or read a column on another table (a fee head's account type).

Ledger postings are not here: they are in `ledger.py`, which is the single write
path to `ledger_entries`.
"""

from __future__ import annotations

import calendar
import datetime
import hashlib
import hmac
import json
import logging
import re
import secrets
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING, Any, Literal

from django.conf import settings
from django.db import IntegrityError, models, transaction
from django.urls import reverse
from django.utils import timezone
from rest_framework import status as http_status
from rest_framework.exceptions import APIException

from apps.fees_finance import ai, invoicing, numbering, reports
from apps.fees_finance.ai import SummaryFacts
from apps.fees_finance.ledger import LedgerLine, post_transaction, reverse_transaction
from apps.fees_finance.models import (
    Budget,
    BudgetStatus,
    Discount,
    DiscountStatus,
    Expense,
    ExpenseCategory,
    ExpenseStatus,
    FeeHead,
    FeeInvoice,
    FeeInvoiceLine,
    FeeSchedule,
    FeeStructure,
    FeeStructureStatus,
    FeeVoucher,
    Fine,
    FineStatus,
    GatewayIssueKind,
    GatewayIssueResolution,
    GatewayReconciliationIssue,
    ImportStatus,
    InvoiceLineSource,
    InvoiceStatus,
    LedgerAccount,
    LedgerAccountType,
    LedgerEntry,
    LedgerReferenceType,
    Payment,
    PaymentGatewayAccount,
    PaymentMethod,
    PaymentStatus,
    Receipt,
    Refund,
    RefundStatus,
    Scholarship,
    SettlementRow,
    VoucherCollectionImport,
    VoucherStatus,
)
from core.ai.redaction import Pseudonymizer
from core.api.exceptions import Conflict, DomainRuleViolation
from core.audit.services import record_system_audit
from core.integrations import crypto
from core.integrations.payments.base import (
    CheckoutRequest,
    CheckoutSession,
    GatewayEvent,
    GatewayUnavailable,
)
from core.integrations.payments.registry import adapter_for
from core.money import ZERO, quantize_money
from core.tenancy.context import tenant_atomic
from core.tenancy.urls import tenant_app_url

if TYPE_CHECKING:
    from core.rbac.permissions import AnyOf
    from core.tenancy.models import Tenant

logger = logging.getLogger(__name__)

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
    """A head referenced anywhere cannot be deleted, only deactivated.

    `is_active=False` removes it from new structures while every historical
    reference keeps its meaning. Deleting it would leave those rows describing
    a charge nobody can name — and `fee_heads_code_unique` is conditioned on
    `deleted_at IS NULL`, so a deleted head's code is immediately reusable by a
    new one, the same code-reuse shape flagged on `LedgerAccount`.

    Three tables reference a head, and pricing it into a `FeeSchedule` is only
    one of them. A fine-category head is never priced into a schedule at all —
    it exists purely for `Fine.fee_head` — and `generate_invoices` also writes
    `FeeInvoiceLine.fee_head` directly, independent of whichever schedule (if
    any) produced the line. A check that only looked at `FeeSchedule` would let
    a fine-only or already-invoiced head be deleted while still referenced.
    """
    referenced = (
        FeeSchedule.objects.alive().filter(fee_head=fee_head).exists()
        or Fine.objects.alive().filter(fee_head=fee_head).exists()
        or FeeInvoiceLine.objects.alive().filter(fee_head=fee_head).exists()
    )
    if referenced:
        raise DomainRuleViolation(
            {
                "fee_head": (
                    "This fee head is referenced by a fee schedule, a fine or an "
                    "invoice line. Deactivate it instead — historical records still "
                    "refer to it."
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


# --------------------------------------------------------------------------- #
# Invoicing (PR B)
# --------------------------------------------------------------------------- #


def resolve_period(
    *, academic_session, period_start: datetime.date | None = None, term=None
) -> tuple[datetime.date, datetime.date, str]:
    """The billing window and its label, from whichever period the caller named.

    A per-term run bills the term's own span; a monthly one bills the calendar
    month containing `period_start`. Both are clamped to the session, so a run
    aimed at a month the session does not cover bills nothing rather than
    inventing charges outside the year a parent enrolled for.
    """
    if term is not None:
        start = max(term.start_date, academic_session.start_date)
        end = min(term.end_date, academic_session.end_date)
        return start, end, term.name

    if period_start is None:
        raise DomainRuleViolation({"period_start": "Name a month to bill, or a term."})

    last_day = calendar.monthrange(period_start.year, period_start.month)[1]
    start = max(period_start.replace(day=1), academic_session.start_date)
    end = min(period_start.replace(day=last_day), academic_session.end_date)
    return start, end, period_start.strftime("%Y-%m")


def assert_structure_is_billable(*, structure: FeeStructure) -> None:
    """Only an active structure prices an invoice.

    A draft structure is still being edited, and an archived one is last year's
    prices. Billing from either produces invoices a school has to cancel and
    re-issue, which is exactly the correction the duplicate guard's `canceled`
    exclusion exists to permit — but far better not to need it.
    """
    if structure.status != FeeStructureStatus.ACTIVE:
        raise DomainRuleViolation(
            {
                "fee_structure": (
                    f"'{structure.name}' is {structure.get_status_display().lower()}. "
                    "Only an active structure prices invoices."
                )
            }
        )


def _collect_generation_inputs(*, structure: FeeStructure, session_id):
    """Everything a whole billing run needs, in a fixed number of queries.

    Six queries regardless of how many students are billed. The alternative —
    fetching a student's grants and fines inside the loop — is the N+1 that
    turns a 2000-student run into a timeout, and it is the shape
    `ENGINEERING_STANDARDS` §3 names. Asserted by
    `test_generating_a_whole_session_is_a_bounded_number_of_queries`.
    """
    from apps.student_management.models import EnrollmentStatus, StudentEnrollment

    schedules = list(
        FeeSchedule.objects.alive().filter(fee_structure=structure).select_related("fee_head")
    )
    head_names = {schedule.fee_head_id: schedule.fee_head.name for schedule in schedules}

    enrollments = list(
        StudentEnrollment.objects.alive()
        .filter(academic_session_id=session_id, status=EnrollmentStatus.ACTIVE)
        .select_related("student")
    )
    if structure.school_class_id is not None:
        enrollments = [e for e in enrollments if e.school_class_id == structure.school_class_id]
    if structure.campus_id is not None:
        enrollments = [e for e in enrollments if e.student.campus_id == structure.campus_id]

    student_ids = [e.student_id for e in enrollments]

    discounts_by_student: dict = {}
    for discount in Discount.objects.alive().filter(
        student_id__in=student_ids,
        academic_session_id=session_id,
        status=DiscountStatus.ACTIVE,
    ):
        discounts_by_student.setdefault(discount.student_id, []).append(discount)

    scholarships_by_student: dict = {}
    for scholarship in Scholarship.objects.alive().filter(
        student_id__in=student_ids,
        academic_session_id=session_id,
        status__in=invoicing.BILLABLE_SCHOLARSHIP_STATUSES,
    ):
        scholarships_by_student.setdefault(scholarship.student_id, []).append(scholarship)

    fines_by_student: dict = {}
    for fine in Fine.objects.alive().filter(student_id__in=student_ids, status=FineStatus.PENDING):
        fines_by_student.setdefault(fine.student_id, []).append(fine)

    return {
        "schedules": schedules,
        "head_names": head_names,
        "enrollments": enrollments,
        "discounts": discounts_by_student,
        "scholarships": scholarships_by_student,
        "fines": fines_by_student,
    }


@transaction.atomic
def generate_invoices(
    *,
    structure: FeeStructure,
    period_start: datetime.date | None = None,
    term=None,
    actor_id: uuid.UUID | None,
    tenant_id: uuid.UUID,
) -> dict:
    """Bill every active enrollment the structure covers, for one period.

    Returns `{"issued", "skipped", "rows"}`. **Skipping is the normal outcome of
    a re-run**, not an error: the duplicate guard means a student already billed
    for this period is left exactly as they are, so a job retried after a
    partial failure finishes the remainder rather than refusing outright. §7.1
    calls generation a background job for this reason — a term's billing is not
    work an accountant should watch a spinner for.

    One transaction for the whole run. A half-billed class is worse than an
    unbilled one: the accountant cannot tell which students were done without
    reading every invoice, and the duplicate guard would then make a clean
    re-run impossible to distinguish from a double-billing attempt.

    **The structure is locked `FOR UPDATE` before `already` is read.** Without
    it, two runs firing at once for the same structure and period (a retried
    Celery delivery, or two staff members both clicking generate) both read the
    *same* `already` set — neither sees the other's still-uncommitted inserts —
    and both then try to create the same student's invoice. The duplicate guard
    is exactly what refuses the second one, but as an uncaught `IntegrityError`
    partway through this one transaction, which the "skip and finish the
    remainder" story only holds for a *sequential* retry, not a genuinely
    concurrent one. The lock makes the second run wait for the first to commit,
    so it then sees the correct, up-to-date `already` set and skips cleanly —
    the same shape `activate_fee_structure` and `record_payment` already use to
    close this class of race.
    """
    structure = (
        FeeStructure.objects.select_for_update()
        .select_related("academic_session")
        .get(pk=structure.pk)
    )
    assert_structure_is_billable(structure=structure)
    session = structure.academic_session
    window_start, window_end, label = resolve_period(
        academic_session=session, period_start=period_start, term=term
    )
    if window_start > window_end:
        raise DomainRuleViolation(
            {
                "period_start": (
                    f"{period_start} falls outside {session.name}, which runs "
                    f"{session.start_date} to {session.end_date}."
                )
            }
        )

    inputs = _collect_generation_inputs(structure=structure, session_id=session.pk)
    # The students the duplicate guard would refuse, read once so a re-run
    # reports "skipped" rather than hitting the index student by student.
    already = set(
        FeeInvoice.objects.alive()
        .filter(fee_structure=structure, period_label=label)
        .exclude(status=InvoiceStatus.CANCELED)
        .values_list("student_id", flat=True)
    )

    issued: list[dict] = []
    skipped = 0
    invoiced_fine_ids: list[uuid.UUID] = []

    for enrollment in inputs["enrollments"]:
        if enrollment.student_id in already:
            skipped += 1
            continue

        student_fines = inputs["fines"].get(enrollment.student_id, [])
        draft = invoicing.build_draft(
            schedules=inputs["schedules"],
            fines=student_fines,
            discounts=inputs["discounts"].get(enrollment.student_id, []),
            scholarships=inputs["scholarships"].get(enrollment.student_id, []),
            period_start=window_start,
            period_end=window_end,
            term_id=term.pk if term is not None else None,
            term_end=term.end_date if term is not None else None,
            enrolled_from=enrollment.enrollment_date,
            head_names=inputs["head_names"],
        )
        if not draft.lines:
            # Nothing owed for this period — a per-term-only structure billed in
            # a month with no term, say. Not an error and not a skip: there is
            # simply no invoice to raise, and raising a zero one would put an
            # empty statement in front of a parent.
            continue

        invoice = FeeInvoice.objects.create(
            tenant_id=tenant_id,
            invoice_no=numbering.allocate_invoice_no(tenant_id=tenant_id, issue_date=window_start),
            student_id=enrollment.student_id,
            student_enrollment=enrollment,
            academic_session=session,
            fee_structure=structure,
            period_label=label,
            issue_date=window_start,
            due_date=draft.due_date or window_end,
            status=InvoiceStatus.ISSUED,
            subtotal=draft.subtotal,
            discount_total=draft.discount_total,
            fine_total=draft.fine_total,
            paid_total=ZERO,
            balance_due=draft.balance_due,
            created_by=actor_id,
            updated_by=actor_id,
        )
        FeeInvoiceLine.objects.bulk_create(
            [
                FeeInvoiceLine(
                    tenant_id=tenant_id,
                    fee_invoice=invoice,
                    fee_head_id=line.fee_head_id,
                    description=line.description,
                    amount=line.amount,
                    discount_amount=line.discount_amount,
                    source_type=line.source_type,
                    source_id=line.source_id,
                    created_by=actor_id,
                    updated_by=actor_id,
                )
                for line in draft.lines
            ]
        )
        invoiced_fine_ids.extend(fine.pk for fine in student_fines)
        issued.append(
            {
                "invoice_id": str(invoice.pk),
                "invoice_no": invoice.invoice_no,
                "student_id": str(enrollment.student_id),
                "balance_due": str(invoice.balance_due),
            }
        )

    if invoiced_fine_ids:
        # One UPDATE for the whole run, in the same transaction as the lines
        # that billed them — a fine marked invoiced with no line, or the
        # reverse, is a charge that is either lost or billed twice.
        Fine.objects.filter(pk__in=invoiced_fine_ids).update(
            status=FineStatus.INVOICED, updated_by=actor_id, updated_at=timezone.now()
        )

    return {"issued": len(issued), "skipped": skipped, "rows": issued}


@transaction.atomic
def cancel_invoice(*, invoice: FeeInvoice, reason: str, actor_id: uuid.UUID | None) -> FeeInvoice:
    """Void an invoice, releasing its period so it can be re-issued.

    Refused once anything has been paid against it: money already received
    cannot be un-received, and §7.3's refund workflow is the route for that.
    Refused too while an online checkout is pending (409 `pending_online_payment`).
    Cancelling a part-paid invoice would leave the payment pointing at a void
    charge and the ledger describing income the school no longer claims.
    """
    locked = FeeInvoice.objects.select_for_update().get(pk=invoice.pk)
    if not reason.strip():
        raise DomainRuleViolation({"reason": "Cancelling an invoice requires a reason."})
    if locked.status == InvoiceStatus.CANCELED:
        raise DomainRuleViolation({"status": "This invoice is already canceled."})
    if locked.paid_total > ZERO:
        raise DomainRuleViolation(
            {
                "status": (
                    f"{locked.paid_total} has been paid against this invoice. Refund the "
                    "payment rather than cancelling the charge."
                )
            }
        )
    # A family may be paying it online right now; the money would land on a void
    # charge. Wait for the checkout to confirm or fail (at most its TTL).
    pending = _pending_online(locked.pk).first()
    if pending is not None:
        raise PendingOnlinePayment(pending)

    # Fines billed on this invoice go back in the queue rather than vanishing —
    # a cancelled invoice must not quietly forgive a library charge.
    released = list(
        FeeInvoiceLine.objects.alive()
        .filter(fee_invoice=locked, source_type=InvoiceLineSource.FINE)
        .values_list("source_id", flat=True)
    )
    if released:
        Fine.objects.filter(pk__in=[pk for pk in released if pk]).update(
            status=FineStatus.PENDING, updated_by=actor_id, updated_at=timezone.now()
        )

    locked.status = InvoiceStatus.CANCELED
    locked.canceled_reason = reason
    locked.updated_by = actor_id
    locked.save(update_fields=["status", "canceled_reason", "updated_by", "updated_at"])
    return locked


@transaction.atomic
def waive_fine(*, fine: Fine, reason: str, actor_id: uuid.UUID | None) -> Fine:
    """Forgive a fine. §4 puts this behind `fees.fine.waive`.

    Only a `pending` fine may be waived. Once it is on an invoice the charge is
    part of a document a parent has been given, and the correction is an
    adjustment line or a cancellation — not editing the fine out from under it.
    """
    locked = Fine.objects.select_for_update().get(pk=fine.pk)
    if not reason.strip():
        raise DomainRuleViolation({"reason": "Waiving a fine requires a reason."})
    if locked.status != FineStatus.PENDING:
        raise DomainRuleViolation(
            {
                "status": (
                    f"This fine is {locked.get_status_display().lower()}. Only a pending "
                    "fine can be waived; an invoiced one needs an adjustment or a "
                    "cancellation."
                )
            }
        )

    locked.status = FineStatus.WAIVED
    locked.waived_by = actor_id
    locked.waived_reason = reason
    locked.updated_by = actor_id
    locked.save(update_fields=["status", "waived_by", "waived_reason", "updated_by", "updated_at"])
    return locked


@transaction.atomic
def revoke_discount(*, discount: Discount, reason: str, actor_id: uuid.UUID | None) -> Discount:
    """End a grant. Invoices already priced with it are untouched.

    Revocation is forward-looking by design: re-pricing issued invoices would
    change what a parent was told they owe, which is a correction that belongs
    in an adjustment line rather than a silent rewrite.

    **`reason` is left exactly as it was.** `discounts` has one text column,
    unlike `fines` — which keeps `reason` (why it was raised) and
    `waived_reason` (why it was forgiven) separate precisely so neither
    overwrites the other. A discount's `reason` records why it was *granted*,
    and a revocation overwriting it would destroy that record with no way to
    recover it: an accountant reviewing a revoked discount six months later
    would read the revocation's reason and have no way to tell what the grant
    itself was for. The caller's stated reason for revoking still reaches the
    audit trail — `record_audit`'s `after` payload — which is the durable,
    queryable place a decision like this belongs, without overloading a column
    the schema gives one meaning.
    """
    locked = Discount.objects.select_for_update().get(pk=discount.pk)
    if not reason.strip():
        raise DomainRuleViolation({"reason": "Revoking a discount requires a reason."})
    locked.status = DiscountStatus.REVOKED
    locked.updated_by = actor_id
    locked.save(update_fields=["status", "updated_by", "updated_at"])
    return locked


# --------------------------------------------------------------------------- #
# Collection (PR C)
# --------------------------------------------------------------------------- #


def _recompute_invoice_totals(invoice: FeeInvoice) -> FeeInvoice:
    """Refresh `paid_total`, `balance_due` and `status` from confirmed payments.

    All five money columns move together, because `fee_invoices_balance_is_derived`
    is a CHECK: writing `paid_total` without `balance_due` is a state the
    database refuses outright, which is the point of having the constraint.

    Only **confirmed** payments count, and refunds are netted off. A pending
    gateway payment that moved a balance would be a receipt the school cannot
    honour if the webhook never arrives.
    """
    paid = (
        Payment.objects.alive()
        .filter(fee_invoice=invoice, status=PaymentStatus.CONFIRMED)
        .aggregate(total=models.Sum("amount"))["total"]
        or ZERO
    )
    refunded = (
        Refund.objects.alive()
        .filter(payment__fee_invoice=invoice, status=RefundStatus.PROCESSED)
        .aggregate(total=models.Sum("amount"))["total"]
        or ZERO
    )

    net_paid = quantize_money(paid - refunded)
    charged = quantize_money(invoice.subtotal - invoice.discount_total + invoice.fine_total)
    invoice.paid_total = net_paid
    invoice.balance_due = quantize_money(charged - net_paid)

    if invoice.status != InvoiceStatus.CANCELED:
        if invoice.balance_due <= ZERO:
            invoice.status = InvoiceStatus.PAID
        elif net_paid > ZERO:
            invoice.status = InvoiceStatus.PARTIALLY_PAID
        elif invoice.due_date < timezone.localdate():
            invoice.status = InvoiceStatus.OVERDUE
        else:
            invoice.status = InvoiceStatus.ISSUED

    invoice.save(update_fields=["paid_total", "balance_due", "status", "updated_at"])
    return invoice


def _fee_income_accounts(*, invoice: FeeInvoice) -> dict:
    """The income account each of this invoice's lines posts to.

    One query for the invoice's heads. A payment posts debit-cash /
    credit-income, and the income side is split across whichever heads the
    invoice charged — a school that maps transport to its own account expects
    the transport share to land there rather than in general fee income.
    """
    lines = FeeInvoiceLine.objects.alive().filter(fee_invoice=invoice).select_related("fee_head")
    shares: dict = {}
    for line in lines:
        net = quantize_money(line.amount - line.discount_amount)
        if net <= ZERO:
            continue
        account_id = line.fee_head.ledger_account_id
        shares[account_id] = quantize_money(shares.get(account_id, ZERO) + net)
    return shares


def _cash_account_for(method: str) -> str:
    """Which asset account money of this kind lands in.

    Cash at a counter is `1000`; everything else clears through the bank. A
    school reconciling a bank statement needs the two separated, and this is the
    one place that mapping is made.
    """
    return "1000" if method == PaymentMethod.CASH else "1010"


def _post_payment_to_ledger(
    *, payment: Payment, invoice: FeeInvoice, actor_id: uuid.UUID | None
) -> uuid.UUID:
    """Debit the asset account, credit the income accounts the invoice charged.

    Split across heads in proportion to what each head was actually billed, so a
    part payment credits each income account its share rather than dumping the
    lot in whichever head sorted first. The remainder from rounding goes to the
    largest share, which keeps Σ credit exactly equal to the debit — the thing
    `assert_balanced` is about to check.
    """
    accounts = {
        account.code: account
        for account in LedgerAccount.objects.alive().filter(
            code__in=[_cash_account_for(payment.method), "4000"]
        )
    }
    asset = accounts[_cash_account_for(payment.method)]

    shares = _fee_income_accounts(invoice=invoice)
    charged = quantize_money(sum(shares.values(), ZERO))
    if charged <= ZERO:
        # An invoice whose lines were entirely discounted still takes money if
        # a school insists; credit general fee income rather than refusing.
        shares = {accounts["4000"].pk: payment.amount}
        charged = payment.amount

    credits: list[LedgerLine] = []
    allocated = ZERO
    # Largest share first: its remainder-absorbing portion is computed last
    # (once `allocated` covers everything else), but the *account* it lands on
    # is `ordered[0]`, not `ordered[-1]` — a one-cent drift lands proportionally
    # lighter against the largest share than the smallest.
    ordered = sorted(shares.items(), key=lambda item: item[1], reverse=True)
    for index, (account_id, share) in enumerate(ordered):
        if index == 0:
            continue
        portion = quantize_money(payment.amount * share / charged)
        allocated = quantize_money(allocated + portion)
        if portion > ZERO:
            credits.append(LedgerLine(ledger_account_id=account_id, credit=portion))

    largest_account_id, _ = ordered[0]
    largest_portion = quantize_money(payment.amount - allocated)
    if largest_portion > ZERO:
        credits.append(LedgerLine(ledger_account_id=largest_account_id, credit=largest_portion))

    return post_transaction(
        entry_date=timezone.localdate(),
        lines=[LedgerLine(ledger_account_id=asset.pk, debit=payment.amount), *credits],
        reference_type=LedgerReferenceType.PAYMENT,
        reference_id=payment.pk,
        actor_id=actor_id,
        memo=f"Payment against {invoice.invoice_no}",
    )


@transaction.atomic
def record_payment(
    *,
    invoice: FeeInvoice,
    amount,
    method: str,
    reference_no: str | None,
    gateway_provider: str | None,
    actor_id: uuid.UUID | None,
    tenant_id: uuid.UUID,
    idempotency_key: str | None = None,
    confirm: bool = True,
    money_received: bool = False,
) -> Payment:
    """Take money against an invoice, in one transaction with everything it implies.

    Locks the invoice, checks the balance, writes the payment, allocates a
    gapless receipt number, writes the receipt, recomputes the five money columns
    and posts to the ledger. **All of it commits together or none of it does** —
    a confirmed payment with no ledger entry is a reconciliation failure nobody
    discovers until year end, and by then the receipt is in a parent's hand.

    The invoice lock is what makes two cashiers taking the same last instalment
    safe. Without it both read the same balance, both pass the check, and the
    invoice ends up overpaid — the missing-`select_for_update` finding PR #53's
    review produced, applied before the fact.

    The check is against the *available* balance: what is due less any online
    checkout still pending, so the cashier cannot take money a family is paying
    online at that moment. `money_received=True` is for money that has already
    moved (a settled bank voucher, a booked gateway issue): it always posts, and
    raises an `overpaid` issue when it exceeds the available balance.
    """
    locked = FeeInvoice.objects.select_for_update().get(pk=invoice.pk)
    amount = quantize_money(amount)

    if locked.status == InvoiceStatus.CANCELED:
        raise DomainRuleViolation(
            {"fee_invoice": f"{locked.invoice_no} is canceled and takes no payment."}
        )
    if amount <= ZERO:
        raise DomainRuleViolation({"amount": "A payment must be for a positive amount."})
    available = available_balance(locked)
    if amount > available and not money_received:
        # §11's default. Advance payment is a §19 recommendation and is not
        # built — see §20.
        meta = {"balance_due": str(locked.balance_due), "available_balance": str(available)}
        message = f"{amount} exceeds the {locked.balance_due} outstanding on {locked.invoice_no}."
        pending = _pending_online(locked.pk).first()
        if pending is not None:
            meta["pending_online_payment_id"] = str(pending.pk)
            message = (
                f"{amount} exceeds the {available} available on {locked.invoice_no}: "
                f"{pending.amount} is being paid online."
            )
        raise DomainRuleViolation({"amount": message}, meta=meta)

    payment = Payment.objects.create(
        tenant_id=tenant_id,
        fee_invoice=locked,
        student_id=locked.student_id,
        amount=amount,
        method=method,
        reference_no=reference_no,
        gateway_provider=gateway_provider,
        status=PaymentStatus.CONFIRMED if confirm else PaymentStatus.PENDING,
        paid_at=timezone.now() if confirm else None,
        received_by=actor_id,
        idempotency_key=idempotency_key,
        created_by=actor_id,
        updated_by=actor_id,
    )

    if confirm:
        confirm_payment(payment=payment, actor_id=actor_id, tenant_id=tenant_id)
    if money_received and amount > available:
        _raise_issue(
            kind=GatewayIssueKind.OVERPAID,
            tenant_id=tenant_id,
            payment=payment,
            gateway_provider=gateway_provider,
            order_id=reference_no,
            expected_amount=available,
            gateway_amount=amount,
        )
    return payment


@transaction.atomic
def confirm_payment(
    *,
    payment: Payment,
    actor_id: uuid.UUID | None,
    tenant_id: uuid.UUID,
    allow_failed: bool = False,
) -> Payment:
    """Move a payment to confirmed, issuing its receipt and posting the ledger.

    Split from `record_payment` because a gateway payment is created `pending`
    and confirmed later by a webhook — the same work, arriving through a
    different door, which is exactly the case AGENTS.md's "rules live in
    services" exists for.

    Idempotent on the payment's status: confirming an already-confirmed payment
    returns it untouched rather than issuing a second receipt. A retried webhook
    is a normal event, not an error.

    A `failed` payment is refused unless `allow_failed`: only the gateway (money
    the provider says arrived after all) and a booked gateway issue pass it.

    Locks the invoice, then the payment, the order the online-payment paths
    (initiation, callbacks, reconciliation, `:resolve`) all follow so they cannot
    deadlock on the pair. `request_refund`/`process_refund` are not yet aligned
    (docs/deferred-work.md).
    """
    invoice = FeeInvoice.objects.select_for_update().get(pk=payment.fee_invoice_id)
    locked = Payment.objects.select_for_update().get(pk=payment.pk)
    if locked.status == PaymentStatus.CONFIRMED and hasattr(locked, "receipt"):
        return locked
    if locked.status == PaymentStatus.REVERSED:
        raise DomainRuleViolation({"status": "A reversed payment cannot be confirmed."})
    if locked.status == PaymentStatus.FAILED and not allow_failed:
        raise DomainRuleViolation({"status": "A failed payment cannot be confirmed."})
    if invoice.status == InvoiceStatus.CANCELED:
        raise DomainRuleViolation(
            {"fee_invoice": f"{invoice.invoice_no} is canceled and takes no payment."}
        )

    locked.status = PaymentStatus.CONFIRMED
    locked.paid_at = locked.paid_at or timezone.now()
    locked.updated_by = actor_id
    locked.save(update_fields=["status", "paid_at", "updated_by", "updated_at"])

    Receipt.objects.create(
        tenant_id=tenant_id,
        payment=locked,
        receipt_no=numbering.allocate_receipt_no(
            tenant_id=tenant_id, issued_on=timezone.localdate()
        ),
        amount=locked.amount,
        created_by=actor_id,
        updated_by=actor_id,
    )
    _post_payment_to_ledger(payment=locked, invoice=invoice, actor_id=actor_id)
    _recompute_invoice_totals(invoice)
    _void_vouchers_for(invoice=invoice, actor_id=actor_id, except_payment_id=locked.pk)
    return locked


def _void_vouchers_for(
    *, invoice: FeeInvoice, actor_id: uuid.UUID | None, except_payment_id=None
) -> int:
    """§6 — a voucher is void once its invoice settles by any other channel.

    Without this a parent who paid at the counter could also pay the voucher at
    a bank, and the school would be holding money it has to refund. Only fully
    settled invoices void their vouchers: a part payment leaves the voucher
    standing, because the balance it names is still owed.
    """
    invoice.refresh_from_db(fields=["balance_due"])
    if invoice.balance_due > ZERO:
        return 0
    return (
        FeeVoucher.objects.alive()
        .filter(fee_invoice=invoice, status=VoucherStatus.ISSUED)
        .exclude(payment_id=except_payment_id)
        .update(
            status=VoucherStatus.VOID,
            voided_reason="The invoice was settled through another channel.",
            updated_by=actor_id,
            updated_at=timezone.now(),
        )
    )


def refundable_remainder(*, payment: Payment) -> object:
    """What is left of a payment after refunds already approved or processed.

    A set-level rule: two partial refunds against one payment must not together
    exceed it, and no CHECK can see sibling rows. `requested` counts too —
    otherwise two requests could each pass the check and only collide at
    processing, after an approver has agreed to both.
    """
    committed = (
        Refund.objects.alive()
        .filter(
            payment=payment,
            status__in=(RefundStatus.REQUESTED, RefundStatus.APPROVED, RefundStatus.PROCESSED),
        )
        .aggregate(total=models.Sum("amount"))["total"]
        or ZERO
    )
    return quantize_money(payment.amount - committed)


@transaction.atomic
def request_refund(
    *,
    payment: Payment,
    amount,
    reason: str,
    actor_id: uuid.UUID,
    tenant_id: uuid.UUID,
    idempotency_key: str | None = None,
) -> Refund:
    """§7.3 step one. Bounded by the refundable remainder, not the payment."""
    locked = Payment.objects.select_for_update().select_related("fee_invoice").get(pk=payment.pk)
    amount = quantize_money(amount)

    if not reason.strip():
        raise DomainRuleViolation({"reason": "A refund request must say why."})
    if locked.status != PaymentStatus.CONFIRMED:
        raise DomainRuleViolation({"payment": "Only a confirmed payment can be refunded."})
    remaining = refundable_remainder(payment=locked)
    if amount > remaining:
        raise DomainRuleViolation(
            {"amount": (f"{amount} exceeds the {remaining} still refundable on this payment.")},
            meta={"refundable_remainder": str(remaining)},
        )
    _assert_heads_are_refundable(invoice=locked.fee_invoice)

    return Refund.objects.create(
        tenant_id=tenant_id,
        payment=locked,
        student_id=locked.student_id,
        amount=amount,
        reason=reason,
        status=RefundStatus.REQUESTED,
        requested_by=actor_id,
        idempotency_key=idempotency_key,
        created_by=actor_id,
        updated_by=actor_id,
    )


def _assert_heads_are_refundable(*, invoice: FeeInvoice) -> None:
    """`fee_heads.is_refundable` exists precisely for this.

    An admission fee is typically non-refundable, and refusing at request time
    is far better than after an approver has already agreed to it.
    """
    blocked = list(
        FeeInvoiceLine.objects.alive()
        .filter(fee_invoice=invoice, fee_head__is_refundable=False)
        .values_list("fee_head__code", "fee_head__name")
    )
    if blocked:
        names = ", ".join(f"{code} {name}" for code, name in blocked)
        raise DomainRuleViolation(
            {"payment": f"This invoice charges non-refundable fee head(s): {names}."}
        )


@transaction.atomic
def decide_refund(
    *, refund: Refund, approve: bool, note: str | None, actor_id: uuid.UUID
) -> Refund:
    """§7.3 step two — approve or reject.

    **The requester may not approve their own refund.** Checked here rather than
    in the viewset, because the rule is the module's: it has to hold when a later
    caller approves through some other door. auth-and-rbac §2.4, and the same
    shape examinations' result approval uses.
    """
    locked = Refund.objects.select_for_update().get(pk=refund.pk)
    if locked.status != RefundStatus.REQUESTED:
        raise DomainRuleViolation(
            {"status": f"This refund is already {locked.get_status_display().lower()}."}
        )
    if locked.requested_by == actor_id:
        raise DomainRuleViolation(
            {
                "approved_by": (
                    "The person who requested a refund cannot approve it (auth-and-rbac §2.4)."
                )
            }
        )

    locked.status = RefundStatus.APPROVED if approve else RefundStatus.REJECTED
    locked.approved_by = actor_id
    locked.decision_note = note
    locked.updated_by = actor_id
    locked.save(
        update_fields=["status", "approved_by", "decision_note", "updated_by", "updated_at"]
    )
    return locked


@transaction.atomic
def process_refund(
    *, refund: Refund, method: str, reference_no: str | None, actor_id: uuid.UUID
) -> Refund:
    """§7.3 step three — pay it out and reverse the ledger.

    A **reversal**, never an edit: the original posting stays exactly as made and
    a new transaction moves the same amounts back. That is what append-only means
    on a ledger, and `ledger.reverse_transaction` is where it happens.
    """
    locked = (
        Refund.objects.select_for_update().select_related("payment__fee_invoice").get(pk=refund.pk)
    )
    if locked.status != RefundStatus.APPROVED:
        raise DomainRuleViolation({"status": "Only an approved refund can be processed."})

    original = (
        LedgerEntry.objects.filter(
            reference_type=LedgerReferenceType.PAYMENT, reference_id=locked.payment_id
        )
        .values_list("transaction_id", flat=True)
        .first()
    )
    if original is None:
        raise DomainRuleViolation({"payment": "This payment has no ledger posting to reverse."})

    if locked.amount == locked.payment.amount:
        # A full refund reverses the original posting exactly, which keeps the
        # two transactions visibly paired in the ledger.
        reverse_transaction(
            transaction_id=original,
            entry_date=timezone.localdate(),
            actor_id=actor_id,
            memo=f"Refund of payment {locked.payment_id}",
        )
    else:
        # A partial refund cannot mirror the original — it moves a different
        # amount — so it is posted as its own balanced transaction against the
        # same accounts, tagged `refund` rather than `reversal`.
        _post_partial_refund(refund=locked, original_transaction_id=original, actor_id=actor_id)

    locked.status = RefundStatus.PROCESSED
    locked.method = method
    locked.reference_no = reference_no
    locked.processed_at = timezone.now()
    locked.updated_by = actor_id
    locked.save(
        update_fields=[
            "status",
            "method",
            "reference_no",
            "processed_at",
            "updated_by",
            "updated_at",
        ]
    )
    _recompute_invoice_totals(
        FeeInvoice.objects.select_for_update().get(pk=locked.payment.fee_invoice_id)
    )
    return locked


def _post_partial_refund(
    *, refund: Refund, original_transaction_id: uuid.UUID, actor_id: uuid.UUID | None
) -> uuid.UUID:
    """Mirror the original transaction's accounts, scaled to the refunded share."""
    # `order_by("ledger_account_id")`: a payment posts one debit line (cash or
    # bank) against possibly several credit lines — "payments split the income
    # side across the heads the invoice charged" — and an unordered fetch
    # leaves Postgres free to return them in whatever order a given scan
    # happens to produce, `ledger_entries.pk` being a UUID gives no natural
    # sequence to fall back on. Deterministic, so which line absorbs the
    # rounding remainder below does not vary run to run for the same refund.
    original_lines = list(
        LedgerEntry.objects.filter(transaction_id=original_transaction_id).order_by(
            "ledger_account_id"
        )
    )
    total_debit = quantize_money(sum((line.debit for line in original_lines), ZERO))
    share = refund.amount / total_debit if total_debit else ZERO

    scaled = [
        (line, quantize_money((line.debit or line.credit) * share)) for line in original_lines
    ]
    # The remainder goes to the *last credit line specifically* — not "the
    # last line in whatever order the query returned". Only a credit line's
    # mirrored amount feeds `allocated`, the sum `assert_balanced` is about to
    # check against `refund.amount`; anchoring the correction to "last line"
    # rather than "last credit line" silently skips it whenever the single
    # debit (cash/bank) line happens to sort last, and several independently
    # rounded credit lines can then fail to sum to `refund.amount` exactly.
    last_credit_index = max(
        (index for index, (line, _) in enumerate(scaled) if line.credit), default=None
    )

    lines = []
    allocated = ZERO
    for index, (line, portion) in enumerate(scaled):
        if index == last_credit_index:
            portion = quantize_money(refund.amount - allocated)
        if line.debit:
            lines.append(LedgerLine(ledger_account_id=line.ledger_account_id, credit=portion))
        else:
            lines.append(LedgerLine(ledger_account_id=line.ledger_account_id, debit=portion))
            allocated = quantize_money(allocated + portion)

    return post_transaction(
        entry_date=timezone.localdate(),
        lines=lines,
        reference_type=LedgerReferenceType.REFUND,
        reference_id=refund.pk,
        actor_id=actor_id,
        memo=f"Partial refund of payment {refund.payment_id}",
        # Same reasoning as `reverse_transaction`: this mirrors the original
        # payment's own accounts, so an account archived after that payment
        # posted must not strand a refund against it — a partial refund is a
        # correction of history exactly as much as a full one is.
        allow_archived_accounts=True,
    )


DEFAULT_VOUCHER_VALIDITY_DAYS = 30


def _consumer_number(*, invoice: FeeInvoice, provider: str) -> str:
    """The reference a bank or wallet keys on.

    Derived from the invoice number and the provider rather than allocated from
    a counter, because it must be reproducible: a re-issued voucher for the same
    invoice at the same provider has to be distinguishable from the voided one,
    while a settlement file that arrives late still identifies its invoice. The
    sequence suffix comes from how many vouchers this invoice already has.
    """
    issued = FeeVoucher.objects.alive().filter(fee_invoice=invoice, provider=provider).count()
    digits = "".join(ch for ch in invoice.invoice_no if ch.isdigit()) or "0"
    return f"{provider[:3].upper()}{digits}{issued + 1:02d}"


@transaction.atomic
def issue_voucher(
    *,
    invoice: FeeInvoice,
    provider: str,
    actor_id: uuid.UUID,
    tenant_id: uuid.UUID,
    validity_days: int | None = None,
) -> FeeVoucher:
    """Print a slip a family can pay at a bank counter or wallet agent.

    `amount` is a **snapshot** of the balance at issuance, and the settlement
    matcher compares against the voucher rather than the live invoice. That is
    deliberate: the piece of paper says what the bank will collect, and a
    balance that moves afterwards must not make an already-printed voucher
    unpayable.
    """
    locked = FeeInvoice.objects.select_for_update().get(pk=invoice.pk)
    if locked.status == InvoiceStatus.CANCELED:
        raise DomainRuleViolation(
            {"fee_invoice": f"{locked.invoice_no} is canceled and takes no voucher."}
        )
    if locked.balance_due <= ZERO:
        raise DomainRuleViolation(
            {"fee_invoice": f"{locked.invoice_no} is settled; there is nothing to collect."}
        )

    days = validity_days or _voucher_validity_days(tenant_id=tenant_id)
    return FeeVoucher.objects.create(
        tenant_id=tenant_id,
        fee_invoice=locked,
        student_id=locked.student_id,
        provider=provider,
        consumer_number=_consumer_number(invoice=locked, provider=provider),
        amount=locked.balance_due,
        due_date=timezone.localdate() + datetime.timedelta(days=days),
        status=VoucherStatus.ISSUED,
        issued_by=actor_id,
        created_by=actor_id,
        updated_by=actor_id,
    )


def _voucher_validity_days(*, tenant_id: uuid.UUID) -> int:
    from core.tenancy.models import TenantSettings

    settings = TenantSettings.objects.filter(tenant_id=tenant_id).first()
    finance = (settings.finance if settings else None) or {}
    days = finance.get("voucher_validity_days")
    return days if isinstance(days, int) and days > 0 else DEFAULT_VOUCHER_VALIDITY_DAYS


@transaction.atomic
def void_voucher(*, voucher: FeeVoucher, reason: str, actor_id: uuid.UUID) -> FeeVoucher:
    """§7.2 — a voucher is never edited, only voided and re-issued."""
    locked = FeeVoucher.objects.select_for_update().get(pk=voucher.pk)
    if not reason.strip():
        raise DomainRuleViolation({"reason": "Voiding a voucher requires a reason."})
    if locked.status == VoucherStatus.PAID:
        raise DomainRuleViolation(
            {"status": "A paid voucher cannot be voided. Refund the payment instead."}
        )

    locked.status = VoucherStatus.VOID
    locked.voided_reason = reason
    locked.updated_by = actor_id
    locked.save(update_fields=["status", "voided_reason", "updated_by", "updated_at"])
    return locked


@transaction.atomic
def apply_settlement_rows(
    *,
    voucher_import: VoucherCollectionImport,
    rows: list,
    actor_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> dict:
    """Match a file's rows to vouchers and post what matches. §7.2's reconciliation.

    Three properties this has to have, and each is a separate mechanism:

    * **A row posts at most once.** §11's match key
      `(provider, consumer_number, transaction_reference)` is a unique index on
      `voucher_settlement_rows`, so re-importing yesterday's file is a no-op
      rather than a double payment. Checked by reading the existing keys once
      rather than catching IntegrityError per row.
    * **An unmatched row does not fail the file.** It lands in `exceptions` for
      an accountant, because one bank's typo must not stop four hundred other
      rows posting.
    * **A matched row goes through `record_payment`.** No shortcut: the
      settlement path gets the same receipt, ledger posting and total
      recomputation as a payment taken at a counter, or the two would drift.
      It passes `money_received=True`: the bank already holds the money, so it
      posts past the balance and raises an `overpaid` issue rather than
      landing in the exceptions queue.
    """
    provider = voucher_import.provider
    already = set(
        SettlementRow.objects.alive()
        .filter(provider=provider)
        .values_list("consumer_number", "transaction_reference")
    )
    vouchers = {
        voucher.consumer_number: voucher
        for voucher in FeeVoucher.objects.alive()
        .filter(provider=provider, status=VoucherStatus.ISSUED)
        .select_related("fee_invoice")
    }

    exceptions: list[dict] = list(voucher_import.exceptions or [])
    matched = 0

    for row in rows:
        key = (row.consumer_number, row.transaction_reference)
        if key in already:
            # Already posted by an earlier import. Not an exception — a re-import
            # is a normal operational event and reporting it as a problem would
            # train accountants to ignore the queue.
            continue

        voucher = vouchers.get(row.consumer_number)
        if voucher is None:
            exceptions.append(
                {
                    "row": row.row_number,
                    "provider_reference": row.transaction_reference,
                    "amount": str(row.amount),
                    "reason": (
                        f"No open voucher with consumer number "
                        f"'{row.consumer_number}' for {provider}."
                    ),
                }
            )
            continue
        if quantize_money(row.amount) != voucher.amount:
            # A short or over payment is a decision, not an automatic posting:
            # the school may accept it, chase the difference, or re-issue.
            exceptions.append(
                {
                    "row": row.row_number,
                    "provider_reference": row.transaction_reference,
                    "amount": str(row.amount),
                    "reason": (f"Settled {row.amount} against a voucher for {voucher.amount}."),
                }
            )
            continue

        # A savepoint per row, caught here: `record_payment` can still refuse a
        # row that matched cleanly on consumer number and amount — the invoice
        # was canceled between when the voucher was issued and when this file
        # settles it. Letting that propagate would
        # abort the whole import on one row, the same failure this function's
        # own "an unmatched row does not fail the file" guarantee exists to
        # prevent — it just arrives through `record_payment` instead of a
        # missing voucher.
        try:
            with transaction.atomic():
                # Re-fetched and locked, not the `vouchers` dict's snapshot from
                # before the loop started: a voucher can go `void` mid-import —
                # a family settling at the counter while this exact file is
                # being reconciled is the ordinary case `void_voucher` exists
                # for — and the invoice's own balance check cannot catch that,
                # since a partly-covered invoice can still have room for a
                # second, no-longer-legitimate settlement to fit under it.
                locked_voucher = FeeVoucher.objects.select_for_update().get(pk=voucher.pk)
                if locked_voucher.status != VoucherStatus.ISSUED:
                    raise DomainRuleViolation(
                        f"Voucher {locked_voucher.consumer_number} is "
                        f"{locked_voucher.status}, not issued."
                    )
                payment = record_payment(
                    invoice=voucher.fee_invoice,
                    amount=row.amount,
                    method=PaymentMethod.BANK_TRANSFER,
                    reference_no=row.transaction_reference,
                    gateway_provider=None,
                    # No `received_by`: nobody at the school handled this money.
                    actor_id=None,
                    tenant_id=tenant_id,
                    # The bank already holds it: it posts even past a pending
                    # online checkout, and raises `overpaid` if it overpays.
                    money_received=True,
                )
                SettlementRow.objects.create(
                    tenant_id=tenant_id,
                    voucher_import=voucher_import,
                    provider=provider,
                    consumer_number=row.consumer_number,
                    transaction_reference=row.transaction_reference,
                    amount=quantize_money(row.amount),
                    paid_on=row.paid_on,
                    payment=payment,
                    created_by=actor_id,
                    updated_by=actor_id,
                )
                FeeVoucher.objects.filter(pk=voucher.pk).update(
                    status=VoucherStatus.PAID,
                    payment=payment,
                    updated_by=actor_id,
                    updated_at=timezone.now(),
                )
        except DomainRuleViolation as exc:
            exceptions.append(
                {
                    "row": row.row_number,
                    "provider_reference": row.transaction_reference,
                    "amount": str(row.amount),
                    "reason": f"Could not post: {exc.detail}",
                }
            )
            continue

        already.add(key)
        vouchers.pop(row.consumer_number, None)
        matched += 1

    voucher_import.row_count = len(rows) + len(
        [e for e in (voucher_import.exceptions or []) if e.get("row") == 0]
    )
    voucher_import.matched_count = matched
    voucher_import.exceptions = exceptions
    voucher_import.status = ImportStatus.COMPLETED
    voucher_import.completed_at = timezone.now()
    voucher_import.updated_by = actor_id
    voucher_import.save(
        update_fields=[
            "row_count",
            "matched_count",
            "exceptions",
            "status",
            "completed_at",
            "updated_by",
            "updated_at",
        ]
    )
    return {
        "row_count": voucher_import.row_count,
        "matched": matched,
        "exceptions": len(exceptions),
    }


def expire_tenant_vouchers(tenant_id: uuid.UUID) -> int:
    """§7.2 — an unpaid voucher past its due date is void and must be re-issued.

    A sweep step in `for_each_tenant`'s shape. It matters that this runs: an
    expired voucher still sitting `issued` would be matched by a late settlement
    file and post a payment for an amount the invoice may no longer owe.
    """
    return (
        FeeVoucher.objects.alive()
        .filter(status=VoucherStatus.ISSUED, due_date__lt=timezone.localdate())
        .update(
            status=VoucherStatus.EXPIRED,
            voided_reason="The voucher passed its due date unpaid.",
            updated_at=timezone.now(),
        )
    )


# --------------------------------------------------------------------------- #
# Online payments (ADR-0034)
# --------------------------------------------------------------------------- #
#
# A family pays through the school's own merchant account. The rules:
#
# * **One lock order:** the invoice, then the payment. Every function below
#   that locks both takes them in that order.
# * **No provider call holds a lock or an open transaction.** Initiation commits
#   the pending payment, then calls the provider; a callback is verified and
#   re-fetched before its transaction opens.
# * **Money that has arrived always posts.** A disagreement becomes a
#   `GatewayReconciliationIssue` for a person, never a silent drop.

ONLINE_PAYMENTS_FEATURE = "fees.online-payments"

#: Namespaces the guardian's Idempotency-Key in `payments.idempotency_key`, which
#: the cashier's `payments:record` keys share.
PAY_ONLINE_KEY_PREFIX = "pay-online:"

#: `SH-<invoice_no>-<8 hex>`: ours, sent to the provider as the order id and
#: stored in `reference_no`. The invoice number lets staff book money for an
#: order we have no payment for.
ORDER_ID_PATTERN = re.compile(r"^SH-(?P<invoice_no>.+)-[0-9a-f]{8}$")

#: Issue kinds `book_at_gateway_amount` can resolve: money arrived with no
#: matching confirmed payment. Every other kind is already posted, or never paid.
BOOKABLE_ISSUE_KINDS = frozenset(
    {GatewayIssueKind.AMOUNT_MISMATCH, GatewayIssueKind.UNKNOWN_REFERENCE}
)


class InvoiceNotPayable(Conflict):
    default_detail = "This invoice cannot be paid online."
    default_code = "invoice_not_payable"


class NothingDue(Conflict):
    default_detail = "Nothing is due on this invoice."
    default_code = "nothing_due"


class GatewayNotConfigured(Conflict):
    default_detail = "The school has not set up online payments."
    default_code = "gateway_not_configured"


class PaymentAttemptClosed(Conflict):
    default_detail = (
        "This Idempotency-Key belongs to a payment attempt that is no longer open. "
        "Use a new key to start again."
    )
    default_code = "payment_attempt_closed"


class CheckoutInProgress(Conflict):
    default_detail = "A checkout for this invoice is still being started. Try again in a moment."
    default_code = "checkout_in_progress"


class PendingOnlinePayment(Conflict):
    default_code = "pending_online_payment"

    def __init__(self, payment: Payment) -> None:
        super().__init__(
            f"Online payment {payment.reference_no} of {payment.amount} is pending on this "
            "invoice. Wait for it to confirm or fail before cancelling."
        )
        self.meta = {"pending_online_payment_id": str(payment.pk)}


class CallbackNotVerified(APIException):
    """A signed callback the provider cannot confirm yet: 503, so the provider retries."""

    status_code = http_status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "The provider does not report this transaction yet. Retry later."
    default_code = "transaction_not_found"


class GatewayUnavailableError(APIException):
    status_code = http_status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "The payment provider is unavailable. Try again shortly."
    default_code = "gateway_unavailable"


class InvalidCallbackSignature(DomainRuleViolation):
    status_code = http_status.HTTP_400_BAD_REQUEST
    default_detail = "The callback signature is invalid or stale."
    default_code = "invalid_signature"


def _pending_online(invoice_id) -> models.QuerySet[Payment]:
    return Payment.objects.alive().filter(
        fee_invoice_id=invoice_id,
        method=PaymentMethod.ONLINE_GATEWAY,
        status=PaymentStatus.PENDING,
    )


def _lock_invoice(invoice_id) -> FeeInvoice:
    """The first lock of the invoice-then-payment order."""
    return FeeInvoice.objects.select_for_update().get(pk=invoice_id)


def available_balance(invoice: FeeInvoice) -> Decimal:
    """What may still be taken: the balance due less any online checkout pending.

    A pending checkout may still be paid, so the cashier and a second checkout
    are both refused past it. Money already received is not held to this (see
    `record_payment`'s `money_received`).
    """
    pending = _pending_online(invoice.pk).aggregate(total=models.Sum("amount"))["total"] or ZERO
    return quantize_money(max(invoice.balance_due - pending, ZERO))


def _pending_cutoff() -> datetime.datetime:
    return timezone.now() - datetime.timedelta(minutes=settings.PAYMENT_PENDING_TTL_MINUTES)


def _credentials(account: PaymentGatewayAccount) -> dict:
    return crypto.decrypt(bytes(account.credentials_ciphertext))


def _merge_payload(payment: Payment, **parts) -> dict:
    payload = dict(payment.gateway_payload or {})
    payload.update(parts)
    return payload


def _stored_checkout(payment: Payment) -> CheckoutSession | None:
    checkout = (payment.gateway_payload or {}).get("checkout")
    if not checkout or not checkout.get("redirect_url"):
        return None
    expires_at = checkout.get("expires_at")
    return CheckoutSession(
        redirect_url=checkout["redirect_url"],
        expires_at=datetime.datetime.fromisoformat(expires_at) if expires_at else None,
    )


def _matching_issue(
    *,
    kind: str,
    payment: Payment | None,
    gateway_provider: str | None,
    order_id: str | None,
    provider_txn_id: str | None,
) -> GatewayReconciliationIssue | None:
    """The issue already raised for this discrepancy, open or resolved.

    Keyed on (kind, payment or order id, provider transaction): a dismissed issue
    stays decided, so a replayed callback or a re-run reconcile never reopens it.
    Failing that, the open issue of the same kind for the payment or order, which
    the partial unique indexes allow only one of.
    """
    alive = GatewayReconciliationIssue.objects.alive().filter(kind=kind)
    if payment is not None:
        same = alive.filter(payment=payment)
    else:
        same = alive.filter(
            payment__isnull=True, gateway_provider=gateway_provider, order_id=order_id
        )
    return (
        same.filter(provider_txn_id=provider_txn_id).first()
        or same.filter(resolution__isnull=True).first()
    )


def _raise_issue(
    *,
    kind: str,
    tenant_id: uuid.UUID,
    payment: Payment | None = None,
    gateway_provider: str | None = None,
    order_id: str | None = None,
    provider_txn_id: str | None = None,
    expected_amount: Decimal | None = None,
    gateway_amount: Decimal | None = None,
) -> GatewayReconciliationIssue:
    """Open an issue, or return the one already raised for the same thing (`_matching_issue`).

    Two callbacks or a callback and a reconcile can race to raise the same
    issue; the partial unique indexes let one insert win, and the loser returns
    the winner's row.
    """

    def matching() -> GatewayReconciliationIssue | None:
        return _matching_issue(
            kind=kind,
            payment=payment,
            gateway_provider=gateway_provider,
            order_id=order_id,
            provider_txn_id=provider_txn_id,
        )

    existing = matching()
    if existing is not None:
        return existing
    try:
        with transaction.atomic():
            issue = GatewayReconciliationIssue.objects.create(
                tenant_id=tenant_id,
                kind=kind,
                payment=payment,
                gateway_provider=gateway_provider,
                order_id=order_id,
                provider_txn_id=provider_txn_id,
                expected_amount=expected_amount,
                gateway_amount=gateway_amount,
                detected_at=timezone.now(),
            )
    except IntegrityError:
        existing = matching()
        if existing is None:
            raise
        return existing
    record_system_audit(
        tenant_id,
        "create",
        issue,
        context={"kind": kind, "order_id": order_id, "provider_txn_id": provider_txn_id},
    )
    return issue


def _flag_if_overpaid(*, invoice_id, payment: Payment, tenant_id: uuid.UUID) -> None:
    """An `overpaid` issue when a just-confirmed payment took the balance below zero."""
    balance = FeeInvoice.objects.values_list("balance_due", flat=True).get(pk=invoice_id)
    if balance < ZERO:
        _raise_issue(
            kind=GatewayIssueKind.OVERPAID,
            tenant_id=tenant_id,
            payment=payment,
            gateway_provider=payment.gateway_provider,
            order_id=payment.reference_no,
            provider_txn_id=payment.provider_txn_id,
            expected_amount=quantize_money(max(payment.amount + balance, ZERO)),
            gateway_amount=payment.amount,
        )


def after_payment_confirmed(payment: Payment, *, actor_id: uuid.UUID | None) -> None:
    """Queue the receipt PDF and the family's notification once the payment commits.

    On commit, so neither goes out for a payment that rolled back. `actor_id` is
    None when no person confirmed it (a gateway callback, the reconciliation).
    """
    from apps.fees_finance.tasks import notify_payment_received, render_receipt_task

    tenant_id = str(payment.tenant_id)
    payment_id = str(payment.pk)
    receipt_id = str(Receipt.objects.values_list("pk", flat=True).get(payment_id=payment.pk))
    actor = str(actor_id) if actor_id else None
    transaction.on_commit(
        lambda: render_receipt_task.delay(
            tenant_id=tenant_id, receipt_id=receipt_id, actor_id=actor
        )
    )
    transaction.on_commit(
        lambda: notify_payment_received.delay(tenant_id=tenant_id, payment_id=payment_id)
    )


# --- The gateway account -------------------------------------------------- #


def current_gateway_account() -> PaymentGatewayAccount | None:
    """The active account, else the most recently changed one."""
    return PaymentGatewayAccount.objects.alive().order_by("-is_active", "-updated_at").first()


def active_gateway_account() -> PaymentGatewayAccount | None:
    return PaymentGatewayAccount.objects.alive().filter(is_active=True).first()


@transaction.atomic
def save_gateway_account(
    *,
    provider: str,
    credentials: dict | None,
    is_active: bool,
    actor_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> PaymentGatewayAccount:
    """Set the school's gateway account. Credentials are encrypted; only a mask is kept.

    The same provider updates the account in place (its callback URL stays the
    same). A different provider deactivates the old account and creates a new
    one: the old one keeps its callback token, so a late callback for a payment
    taken through it still applies.
    """
    try:
        adapter = adapter_for(provider)
    except LookupError as exc:
        raise DomainRuleViolation({"provider": f"{provider!r} is not available."}) from exc

    current = (
        PaymentGatewayAccount.objects.alive()
        .select_for_update()
        .order_by("-is_active", "-updated_at")
        .first()
    )
    if current is not None and current.provider == provider:
        if credentials:
            current.credentials_ciphertext = crypto.encrypt(credentials)
            current.merchant_id_masked = adapter.mask_merchant_id(credentials)
        current.is_active = is_active
        current.updated_by = actor_id
        current.save()
        return current

    if not credentials:
        raise DomainRuleViolation({"credentials": "Credentials are required for a new provider."})
    if current is not None and current.is_active:
        current.is_active = False
        current.updated_by = actor_id
        current.save(update_fields=["is_active", "updated_by", "updated_at"])
    return PaymentGatewayAccount.objects.create(
        tenant_id=tenant_id,
        provider=provider,
        is_active=is_active,
        merchant_id_masked=adapter.mask_merchant_id(credentials),
        credentials_ciphertext=crypto.encrypt(credentials),
        callback_token=secrets.token_urlsafe(32),
        created_by=actor_id,
        updated_by=actor_id,
    )


def rotate_gateway_credentials() -> int:
    """Re-encrypt the bound tenant's gateway credentials under the newest key.

    Registered with `core.integrations.crypto` from `AppConfig.ready`, and run
    per tenant by `rotate_integration_credentials`. Soft-deleted rows too, so the
    old key can really be dropped afterwards.
    """
    rotated = 0
    for account in PaymentGatewayAccount.objects.select_for_update():
        account.credentials_ciphertext = crypto.rotate(bytes(account.credentials_ciphertext))
        account.save(update_fields=["credentials_ciphertext", "updated_at"])
        rotated += 1
    return rotated


def gateway_account_for_token(token: str) -> PaymentGatewayAccount | None:
    """The bound tenant's account a callback token names, active or not.

    Every account is compared, with `hmac.compare_digest`, so the time taken does
    not reveal how much of a guessed token matched. A school has one or two rows.
    """
    match = None
    for account in PaymentGatewayAccount.objects.alive():
        if hmac.compare_digest(account.callback_token.encode(), token.encode()):
            match = account
    return match


def callback_url(*, tenant: Tenant, account: PaymentGatewayAccount) -> str:
    """The URL the provider calls, from `API_PUBLIC_URL`: never the request's Host header."""
    path = reverse(
        "v1:payment-callbacks",
        kwargs={"tenant_slug": tenant.slug, "callback_token": account.callback_token},
    )
    return f"{settings.API_PUBLIC_URL.rstrip('/')}{path}"


# --- Initiation ------------------------------------------------------------ #


def initiate_online_payment(
    *,
    invoice: FeeInvoice,
    user: Any,
    tenant: Tenant,
    return_path: str,
    idempotency_key: str,
) -> tuple[Payment, CheckoutSession, bool]:
    """Start a checkout for the invoice's full available balance.

    Three steps, so the provider call holds no lock and no transaction:

    1. Under the invoice lock: fail a pending payment past its TTL, reuse a
       live one, or create one, then commit.
    2. Call the provider. If it is down, fail the payment this request created
       and raise 503; its Idempotency-Key is released so a retry starts afresh.
    3. Store the checkout's redirect on the payment.

    A live pending payment is returned with its stored redirect when the
    provider cannot start a second checkout for one order. One with no stored
    redirect yet is another request's checkout still being started: 409
    `checkout_in_progress`, and no provider call. A repeated Idempotency-Key
    returns its own pending payment the same way.

    Returns the payment, the checkout and whether this call created the payment.
    """
    key = f"{PAY_ONLINE_KEY_PREFIX}{idempotency_key}"
    with tenant_atomic(tenant.pk):
        account = active_gateway_account()
        if account is None:
            raise GatewayNotConfigured()
        try:
            adapter = adapter_for(account.provider)
        except LookupError as exc:
            raise GatewayNotConfigured() from exc

        replay = Payment.objects.alive().filter(idempotency_key=key).first()
        if replay is not None:
            if replay.fee_invoice_id != invoice.pk or replay.status != PaymentStatus.PENDING:
                raise PaymentAttemptClosed()
            stored = _stored_checkout(replay)
            if stored is None:
                raise CheckoutInProgress()
            return replay, stored, False

        locked = FeeInvoice.objects.select_for_update().get(pk=invoice.pk)
        if locked.status in (InvoiceStatus.DRAFT, InvoiceStatus.CANCELED):
            raise InvoiceNotPayable()

        payment: Payment | None = None
        for pending in _pending_online(locked.pk).select_for_update():
            if pending.created_at < _pending_cutoff():
                fail_payment(payment=pending, reason="expired")
            else:
                payment = pending

        created = payment is None
        if payment is not None:
            stored = _stored_checkout(payment)
            if stored is None:
                # Another request committed this payment and is calling the provider.
                raise CheckoutInProgress()
            if not adapter.can_reinitiate:
                return payment, stored, False
        else:
            if locked.balance_due <= ZERO:
                raise NothingDue()
            amount = available_balance(locked)
            if amount <= ZERO:
                raise NothingDue()
            payment = Payment.objects.create(
                tenant_id=tenant.pk,
                fee_invoice=locked,
                student_id=locked.student_id,
                amount=amount,
                method=PaymentMethod.ONLINE_GATEWAY,
                reference_no=f"SH-{locked.invoice_no}-{secrets.token_hex(4)}",
                gateway_provider=account.provider,
                gateway_account=account,
                status=PaymentStatus.PENDING,
                idempotency_key=key,
                created_by=user.pk,
                updated_by=user.pk,
            )

        checkout = CheckoutRequest(
            order_id=str(payment.reference_no),
            amount=payment.amount,
            currency=tenant.currency,
            description=f"Fee invoice {locked.invoice_no}",
            return_url=tenant_app_url(tenant, return_path),
            callback_url=callback_url(tenant=tenant, account=account),
            customer_email=getattr(user, "email", None) or None,
        )
        credentials = _credentials(account)

    try:
        session = adapter.initiate(checkout, credentials)
    except GatewayUnavailable as exc:
        if created:
            with tenant_atomic(tenant.pk):
                fail_payment(
                    payment=payment, reason="gateway_unavailable", release_idempotency_key=True
                )
        raise GatewayUnavailableError() from exc

    with tenant_atomic(tenant.pk):
        stored_payload = _merge_payload(
            payment,
            checkout={
                "redirect_url": session.redirect_url,
                "expires_at": session.expires_at.isoformat() if session.expires_at else None,
            },
        )
        Payment.objects.filter(pk=payment.pk, status=PaymentStatus.PENDING).update(
            gateway_payload=stored_payload, updated_at=timezone.now()
        )
    return payment, session, created


# --- Failing, confirming and resolving -------------------------------------- #


def fail_payment(
    *, payment: Payment, reason: str, release_idempotency_key: bool = False
) -> Payment:
    """`pending → failed`. Anything else is a logged no-op: money is append-only.

    A `failed` callback after a `paid` one, or a sweep racing a callback, must
    never undo a confirmed payment. `release_idempotency_key` clears the key of
    an attempt that never reached the provider, so retrying it with the same key
    starts a new attempt rather than meeting `payment_attempt_closed`.
    """
    with transaction.atomic():
        _lock_invoice(payment.fee_invoice_id)
        locked = Payment.objects.select_for_update().get(pk=payment.pk)
        if locked.status != PaymentStatus.PENDING:
            logger.info(
                "fail_payment ignored: payment %s is %s, not pending", locked.pk, locked.status
            )
            return locked
        locked.status = PaymentStatus.FAILED
        locked.gateway_payload = _merge_payload(locked, failure_reason=reason)
        update_fields = ["status", "gateway_payload", "updated_at"]
        if release_idempotency_key:
            locked.idempotency_key = None
            update_fields.append("idempotency_key")
        locked.save(update_fields=update_fields)
        record_system_audit(
            locked.tenant_id,
            "fail",
            locked,
            context={
                "order_id": locked.reference_no,
                "provider_txn_id": locked.provider_txn_id,
                "reason": reason,
            },
        )
        return locked


def expire_tenant_pending_online_payments(tenant_id: uuid.UUID) -> int:
    """A sweep step: fail online checkouts pending past `PAYMENT_PENDING_TTL_MINUTES`."""
    stale = list(
        Payment.objects.alive()
        .filter(
            method=PaymentMethod.ONLINE_GATEWAY,
            status=PaymentStatus.PENDING,
            created_at__lt=_pending_cutoff(),
        )
        .only("pk", "fee_invoice_id")
    )
    failed = 0
    for payment in stale:
        if fail_payment(payment=payment, reason="expired").status == PaymentStatus.FAILED:
            failed += 1
    return failed


def verify_gateway_callback(
    *, account: PaymentGatewayAccount, headers, body: bytes
) -> GatewayEvent:
    """Check a callback's signature with this account's secret. Raises `InvalidSignature`."""
    adapter = adapter_for(account.provider)
    return adapter.verify_callback(headers, body, _credentials(account), timezone.now())


def handle_gateway_event(
    *,
    account: PaymentGatewayAccount,
    event: GatewayEvent,
    source: Literal["callback", "reconcile"],
) -> Payment | None:
    """Apply what the provider says happened to one of our orders.

    A callback is re-fetched from the provider first, outside any transaction,
    and the fetched transaction is what is applied: a signed callback proves who
    sent it, the fetch proves the money moved. A reconcile event already comes
    from the provider's own transaction list, so it is applied as given.

    Then, under the invoice and payment locks: no payment for the order is an
    `unknown_reference` issue; a paid event on a canceled invoice is
    `paid_on_canceled_invoice` and confirms nothing; a paid amount that differs
    is `amount_mismatch` and confirms nothing; a payment is confirmed even if it had failed
    (`paid_after_failed`), and an `overpaid` issue is raised if the invoice now
    owes less than nothing. A `failed` event only ever fails a pending payment.
    Replays and out-of-order events are no-ops.
    """
    if source == "callback":
        verified = adapter_for(account.provider).fetch_transaction(
            _credentials(account), event.order_id
        )
        if verified is None:
            # Signed but not (yet) at the provider. 503 so the provider retries;
            # the nightly reconcile is the backstop.
            logger.warning(
                "gateway callback for %s not found at the provider; asking for a retry",
                event.order_id,
            )
            raise CallbackNotVerified()
        event = verified

    with tenant_atomic(account.tenant_id):
        return _apply_gateway_event(account=account, event=event, source=source)


def _apply_gateway_event(
    *, account: PaymentGatewayAccount, event: GatewayEvent, source: str
) -> Payment | None:
    tenant_id = account.tenant_id
    found = (
        Payment.objects.alive()
        .filter(
            method=PaymentMethod.ONLINE_GATEWAY,
            gateway_provider=account.provider,
            reference_no=event.order_id,
        )
        .only("pk", "fee_invoice_id")
        .first()
    )
    if found is None:
        if event.status == "paid":
            _raise_issue(
                kind=GatewayIssueKind.UNKNOWN_REFERENCE,
                tenant_id=tenant_id,
                gateway_provider=account.provider,
                order_id=event.order_id,
                provider_txn_id=event.provider_txn_id,
                gateway_amount=quantize_money(event.amount),
            )
        return None

    invoice = _lock_invoice(found.fee_invoice_id)
    payment = Payment.objects.select_for_update().get(pk=found.pk)
    amount = quantize_money(event.amount)

    if payment.status == PaymentStatus.CONFIRMED:
        if (
            event.status == "paid"
            and payment.provider_txn_id
            and payment.provider_txn_id != event.provider_txn_id
        ):
            # A second provider transaction paid an order we already confirmed.
            _raise_issue(
                kind=GatewayIssueKind.DUPLICATE_AT_GATEWAY,
                tenant_id=tenant_id,
                payment=payment,
                gateway_provider=account.provider,
                order_id=event.order_id,
                provider_txn_id=event.provider_txn_id,
                expected_amount=payment.amount,
                gateway_amount=amount,
            )
        return payment

    payment.provider_txn_id = event.provider_txn_id
    payment.gateway_payload = _merge_payload(payment, event=event.sanitized)
    payment.save(update_fields=["provider_txn_id", "gateway_payload", "updated_at"])

    if event.status == "failed":
        return fail_payment(payment=payment, reason="failed_at_gateway")
    if payment.status == PaymentStatus.REVERSED:
        logger.warning("paid event for reversed payment %s ignored", payment.pk)
        return payment
    if invoice.status == InvoiceStatus.CANCELED:
        # Money for a void charge: a person returns it or re-bills; nothing posts.
        _raise_issue(
            kind=GatewayIssueKind.PAID_ON_CANCELED_INVOICE,
            tenant_id=tenant_id,
            payment=payment,
            gateway_provider=account.provider,
            order_id=event.order_id,
            provider_txn_id=event.provider_txn_id,
            expected_amount=payment.amount,
            gateway_amount=amount,
        )
        return payment
    if amount != payment.amount:
        _raise_issue(
            kind=GatewayIssueKind.AMOUNT_MISMATCH,
            tenant_id=tenant_id,
            payment=payment,
            gateway_provider=account.provider,
            order_id=event.order_id,
            provider_txn_id=event.provider_txn_id,
            expected_amount=payment.amount,
            gateway_amount=amount,
        )
        return payment

    was_failed = payment.status == PaymentStatus.FAILED
    confirmed = confirm_payment(
        payment=payment, actor_id=None, tenant_id=tenant_id, allow_failed=True
    )
    if was_failed:
        _raise_issue(
            kind=GatewayIssueKind.PAID_AFTER_FAILED,
            tenant_id=tenant_id,
            payment=confirmed,
            gateway_provider=account.provider,
            order_id=event.order_id,
            provider_txn_id=event.provider_txn_id,
            expected_amount=confirmed.amount,
            gateway_amount=amount,
        )
    _flag_if_overpaid(invoice_id=confirmed.fee_invoice_id, payment=confirmed, tenant_id=tenant_id)
    record_system_audit(
        tenant_id,
        "confirm",
        confirmed,
        context={
            "order_id": event.order_id,
            "provider_txn_id": event.provider_txn_id,
            "amount": str(amount),
            "source": source,
        },
    )
    after_payment_confirmed(confirmed, actor_id=None)
    return confirmed


def _invoice_for_order_id(order_id: str | None) -> FeeInvoice:
    match = ORDER_ID_PATTERN.match(order_id or "")
    invoice = (
        FeeInvoice.objects.alive().filter(invoice_no=match["invoice_no"]).first() if match else None
    )
    if invoice is None:
        raise DomainRuleViolation(
            {
                "action": (
                    "No invoice matches this reference. Return or place the money, then "
                    "dismiss the issue with a note."
                )
            }
        )
    return invoice


@transaction.atomic
def resolve_gateway_issue(
    *,
    issue: GatewayReconciliationIssue,
    action: Literal["book_at_gateway_amount", "dismiss"],
    note: str | None,
    actor_id: uuid.UUID,
) -> GatewayReconciliationIssue:
    """Close an issue once: book the money at the amount the provider verified, or dismiss it.

    `book_at_gateway_amount` confirms the payment at that amount (an
    `amount_mismatch`), or records and confirms one against the invoice named in
    the order id (an `unknown_reference`), with its receipt and ledger posting,
    then raises `overpaid` if the invoice is now overpaid. `dismiss` needs a note
    saying what was done instead, e.g. "refunded at provider".

    Locks the invoice, then the payment, then the issue.
    """
    note = (note or "").strip() or None
    if action not in ("book_at_gateway_amount", "dismiss"):
        raise DomainRuleViolation({"action": f"Unknown action {action!r}."})
    if action == "dismiss" and not note:
        raise DomainRuleViolation(
            {"note": "Say what was done instead, e.g. 'refunded at provider'."}
        )

    tenant_id = issue.tenant_id
    booked: Payment | None = None
    if action == "book_at_gateway_amount":
        if issue.kind not in BOOKABLE_ISSUE_KINDS:
            raise DomainRuleViolation(
                {"action": f"A {issue.kind} issue has nothing to book; dismiss it once handled."}
            )
        if issue.gateway_amount is None or issue.gateway_amount <= ZERO:
            raise DomainRuleViolation({"action": "The provider verified no amount to book."})
        if issue.kind == GatewayIssueKind.AMOUNT_MISMATCH and issue.payment_id is not None:
            payment = Payment.objects.only("pk", "fee_invoice_id").get(pk=issue.payment_id)
            _lock_invoice(payment.fee_invoice_id)
            locked_payment = Payment.objects.select_for_update().get(pk=payment.pk)
            locked = _lock_open_issue(issue)
            if locked_payment.status not in (PaymentStatus.PENDING, PaymentStatus.FAILED):
                raise DomainRuleViolation(
                    {"action": f"The payment is already {locked_payment.status}."}
                )
            locked_payment.amount = issue.gateway_amount
            locked_payment.updated_by = actor_id
            locked_payment.save(update_fields=["amount", "updated_by", "updated_at"])
            booked = confirm_payment(
                payment=locked_payment, actor_id=actor_id, tenant_id=tenant_id, allow_failed=True
            )
            _flag_if_overpaid(invoice_id=booked.fee_invoice_id, payment=booked, tenant_id=tenant_id)
        else:
            invoice = _invoice_for_order_id(issue.order_id)
            _lock_invoice(invoice.pk)
            locked = _lock_open_issue(issue)
            booked = record_payment(
                invoice=invoice,
                amount=issue.gateway_amount,
                method=PaymentMethod.ONLINE_GATEWAY,
                reference_no=issue.order_id,
                gateway_provider=issue.gateway_provider,
                actor_id=actor_id,
                tenant_id=tenant_id,
                money_received=True,
            )
            booked.provider_txn_id = issue.provider_txn_id
            booked.save(update_fields=["provider_txn_id", "updated_at"])
            locked.payment = booked
        after_payment_confirmed(booked, actor_id=actor_id)
        locked.resolution = GatewayIssueResolution.BOOKED
    else:
        locked = _lock_open_issue(issue)
        locked.resolution = GatewayIssueResolution.DISMISSED

    locked.resolved_at = timezone.now()
    locked.resolved_by = actor_id
    locked.note = note
    locked.updated_by = actor_id
    locked.save()
    return locked


def _lock_open_issue(issue: GatewayReconciliationIssue) -> GatewayReconciliationIssue:
    locked = GatewayReconciliationIssue.objects.select_for_update().get(pk=issue.pk)
    if locked.resolution is not None:
        raise Conflict("This issue is already resolved.")
    return locked


# --- Nightly reconciliation -------------------------------------------------- #
#
# A callback can be lost. Once a day each account's transaction list from the
# provider is fetched **outside any transaction**, then every event goes through
# `handle_gateway_event` in its own transaction, so one bad row never undoes the
# confirmations before it and no lock is held across a provider call.


class ReconciliationIncomplete(Exception):
    """At least one of a school's gateway accounts could not be reconciled."""


def _day_bounds(day: datetime.date) -> tuple[datetime.datetime, datetime.datetime]:
    """`day` as a UTC half-open interval: the providers report their days in UTC."""
    start = datetime.datetime.combine(day, datetime.time.min, tzinfo=datetime.UTC)
    return start, start + datetime.timedelta(days=1)


def _accounts_to_reconcile(day: datetime.date) -> list[PaymentGatewayAccount]:
    """The bound tenant's accounts, active or not, that own online payments in `day`'s window.

    The window takes checkouts opened up to one TTL before the day (paid after
    midnight) and payments confirmed during it. An inactive account still has
    money moving through it until its last checkout closes; one with nothing in
    the window (say, an old account whose credentials were revoked) is not called.
    """
    start, end = _day_bounds(day)
    opened_from = start - datetime.timedelta(minutes=settings.PAYMENT_PENDING_TTL_MINUTES)
    owners = (
        Payment.objects.alive()
        .filter(method=PaymentMethod.ONLINE_GATEWAY, gateway_account__isnull=False)
        .filter(
            models.Q(created_at__gte=opened_from, created_at__lt=end)
            | models.Q(paid_at__gte=start, paid_at__lt=end)
        )
        .values("gateway_account_id")
    )
    return list(PaymentGatewayAccount.objects.alive().filter(pk__in=owners))


def _paid_at_provider(*, accounts: list[PaymentGatewayAccount], order_id: str) -> bool:
    """Ask the provider directly before calling a payment missing.

    A payment confirmed just after midnight is in the next day's list, and a
    school that changed merchant accounts on one provider has two. A direct
    lookup under each account settles both. Outside any transaction.
    """
    for account in accounts:
        event = adapter_for(account.provider).fetch_transaction(_credentials(account), order_id)
        if event is not None and event.status == "paid":
            return True
    return False


def reconcile_gateway_day(*, account: PaymentGatewayAccount, day: datetime.date) -> int:
    """Reconcile one account against the provider's list for `day`.

    1. Fetch the day's transactions (no transaction open; `GatewayUnavailable`
       propagates, and the caller skips the tenant).
    2. Apply each event with `handle_gateway_event(source="reconcile")`, each in
       its own transaction. A missed callback confirms here; a failing event is
       logged and the rest still apply.
    3. Two paid provider transactions for one order → `duplicate_at_gateway`.
    4. Our confirmed payment the list lacks, and a direct lookup cannot find
       paid → `missing_at_gateway`. Nothing is reversed; a person decides.

    An issue already raised, open or resolved, is never raised again
    (`_raise_issue`), so a second run of the same day changes nothing.
    Returns the payments whose status changed plus the issues opened.
    """
    tenant_id = account.tenant_id
    adapter = adapter_for(account.provider)
    started = timezone.now()
    events = adapter.list_transactions(_credentials(account), day)

    order_ids = {event.order_id for event in events}

    def online() -> models.QuerySet[Payment]:
        # Built per call, inside `tenant_atomic`: the tenant manager filters on the
        # tenant bound when the queryset is built, and none is bound out here.
        return Payment.objects.alive().filter(
            method=PaymentMethod.ONLINE_GATEWAY, gateway_provider=account.provider
        )

    with tenant_atomic(tenant_id):
        status_before = dict(
            online().filter(reference_no__in=order_ids).values_list("reference_no", "status")
        )

    changed = 0
    for event in events:
        try:
            payment = handle_gateway_event(account=account, event=event, source="reconcile")
        except Exception:
            logger.exception(
                "reconciliation could not apply order %s (tenant %s); continuing",
                event.order_id,
                tenant_id,
            )
            continue
        if payment is not None and status_before.get(event.order_id) != payment.status:
            changed += 1
            status_before[event.order_id] = payment.status

    paid_by_order: dict[str, set[str]] = {}
    for event in events:
        if event.status == "paid":
            paid_by_order.setdefault(event.order_id, set()).add(event.provider_txn_id)
    for order_id, txn_ids in paid_by_order.items():
        if len(txn_ids) < 2:
            continue
        with tenant_atomic(tenant_id):
            payment = online().filter(reference_no=order_id).first()
            if payment is None or payment.status != PaymentStatus.CONFIRMED:
                continue
            extra = sorted(txn_ids - {payment.provider_txn_id})
            _raise_issue(
                kind=GatewayIssueKind.DUPLICATE_AT_GATEWAY,
                tenant_id=tenant_id,
                payment=payment,
                gateway_provider=account.provider,
                order_id=order_id,
                provider_txn_id=extra[0],
                expected_amount=payment.amount,
                gateway_amount=payment.amount,
            )

    start, end = _day_bounds(day)
    with tenant_atomic(tenant_id):
        # This account's payments, plus any with no account recorded (a booked
        # unknown reference), which any account of the provider may have taken.
        unlisted = list(
            online()
            .filter(status=PaymentStatus.CONFIRMED, paid_at__gte=start, paid_at__lt=end)
            .filter(models.Q(gateway_account=account) | models.Q(gateway_account__isnull=True))
            .exclude(reference_no__in=list(paid_by_order))
            .only("pk", "reference_no", "provider_txn_id", "amount", "gateway_account_id")
        )
        same_provider = list(
            PaymentGatewayAccount.objects.alive().filter(provider=account.provider)
        )
    for payment in unlisted:
        ask = [account] if payment.gateway_account_id == account.pk else same_provider
        if _paid_at_provider(accounts=ask, order_id=str(payment.reference_no)):
            continue
        with tenant_atomic(tenant_id):
            _raise_issue(
                kind=GatewayIssueKind.MISSING_AT_GATEWAY,
                tenant_id=tenant_id,
                payment=payment,
                gateway_provider=account.provider,
                order_id=payment.reference_no,
                provider_txn_id=payment.provider_txn_id,
                expected_amount=payment.amount,
            )

    with tenant_atomic(tenant_id):
        opened = GatewayReconciliationIssue.objects.filter(
            gateway_provider=account.provider, detected_at__gte=started
        ).count()
    logger.info(
        "reconciled %s for tenant %s on %s: %d listed, %d payment(s) changed, %d issue(s) opened",
        account.provider,
        tenant_id,
        day.isoformat(),
        len(events),
        changed,
        opened,
    )
    return changed + opened


def reconcile_tenant_gateway_payments(tenant_id: uuid.UUID, *, day: datetime.date) -> int:
    """A non-atomic `for_each_tenant` step: reconcile each account with payments in the window.

    Opens its own short transactions, so the provider calls in
    `reconcile_gateway_day` hold none. One account failing (an outage, an old
    account whose credentials the provider has revoked) is logged and the
    school's other accounts are still reconciled; then `ReconciliationIncomplete`
    is raised so `for_each_tenant` still counts the school as failed.
    """
    with tenant_atomic(tenant_id):
        accounts = _accounts_to_reconcile(day)
    total = 0
    failed = 0
    for account in accounts:
        try:
            total += reconcile_gateway_day(account=account, day=day)
        except Exception:
            failed += 1
            logger.exception(
                "reconciliation failed for %s account %s (tenant %s) on %s; continuing",
                account.provider,
                account.pk,
                tenant_id,
                day.isoformat(),
            )
    if failed:
        raise ReconciliationIncomplete(
            f"{failed} of {len(accounts)} gateway account(s) could not be reconciled"
        )
    return total


# --------------------------------------------------------------------------- #
# Spend and reports (PR D)
# --------------------------------------------------------------------------- #

#: §16's inline ceiling. Past this a report endpoint hands back a job instead —
#: the row cap is requested as `limit + 1` so the endpoint decides which
#: without building a term-scale result twice, which is the fix attendance's
#: review produced.
SYNCHRONOUS_REPORT_ROW_LIMIT = 1000


def assert_expense_category_account_is_expense(*, ledger_account: LedgerAccount) -> None:
    """A category maps to an *expense* account.

    Not a CHECK: `account_type` is on `ledger_accounts` and a constraint on
    `expense_categories` cannot read it. The mirror of the fee-head rule, and
    for the same reason — spend filed against an income account makes the
    income statement wrong in a way that still balances.
    """
    if ledger_account.account_type != LedgerAccountType.EXPENSE:
        raise DomainRuleViolation(
            {
                "ledger_account": (
                    f"An expense category must map to an expense account. "
                    f"{ledger_account.code} {ledger_account.name} is "
                    f"{ledger_account.get_account_type_display().lower()}."
                )
            }
        )


def assert_expense_category_may_be_deleted(*, category: ExpenseCategory) -> None:
    """Deletion frees the code for reuse — `expense_categories_code_unique` is
    conditioned on `deleted_at IS NULL`, same as `LedgerAccount`'s. A category
    with expenses or budgets already filed against it must never be
    deletable: a new category could then take its code while the old rows
    still exist under a now-invisible row, and "Utilities" would silently
    mean two different things depending on when you asked. `is_active=False`
    is the retirement path once anything references it — it keeps the row and
    its code, so the FK on every expense and budget keeps resolving to
    something a report can still show.
    """
    if Expense.objects.filter(expense_category=category).exists():
        raise DomainRuleViolation(
            {
                "id": (
                    f"{category.code} {category.name} has expenses filed against it "
                    "and cannot be deleted. Set is_active=False instead — its code "
                    "stays reserved and its history stays under it."
                )
            }
        )
    if Budget.objects.filter(expense_category=category).exists():
        raise DomainRuleViolation(
            {
                "id": (
                    f"{category.code} {category.name} has a budget against it and "
                    "cannot be deleted. Set is_active=False instead."
                )
            }
        )


@transaction.atomic
def submit_expense(*, expense: Expense, actor_id: uuid.UUID) -> Expense:
    """Move a draft expense into the approval queue."""
    locked = Expense.objects.select_for_update().get(pk=expense.pk)
    if locked.status != ExpenseStatus.DRAFT:
        raise DomainRuleViolation(
            {"status": f"This expense is already {locked.get_status_display().lower()}."}
        )
    locked.status = ExpenseStatus.SUBMITTED
    locked.updated_by = actor_id
    locked.save(update_fields=["status", "updated_by", "updated_at"])
    return locked


@transaction.atomic
def decide_expense(*, expense: Expense, approve: bool, actor_id: uuid.UUID) -> Expense:
    """Approve or reject a submitted expense, posting the ledger on approval.

    **The submitter may not approve their own expense.** §15 says so, and the
    check is here rather than in the viewset for the reason refunds' is: the
    rule is the module's and has to hold through any door. The CHECK constraint
    carries the half a constraint can.

    Approval is what posts to the ledger — debit the category's expense account,
    credit cash or bank. Recognising the cost at approval rather than at payment
    is what makes §13's income-vs-expense report describe the period a school
    committed the money in.
    """
    locked = (
        Expense.objects.select_for_update()
        .select_related("expense_category__ledger_account")
        .get(pk=expense.pk)
    )
    if locked.status != ExpenseStatus.SUBMITTED:
        raise DomainRuleViolation(
            {"status": "Only a submitted expense can be approved or rejected."}
        )
    if locked.created_by == actor_id:
        raise DomainRuleViolation(
            {
                "approved_by": (
                    "The person who submitted an expense cannot approve it "
                    "(§15, and auth-and-rbac §2.4)."
                )
            }
        )

    locked.status = ExpenseStatus.APPROVED if approve else ExpenseStatus.REJECTED
    locked.approved_by = actor_id
    locked.updated_by = actor_id
    locked.save(update_fields=["status", "approved_by", "updated_by", "updated_at"])

    if approve:
        _post_expense_to_ledger(expense=locked, actor_id=actor_id)
    return locked


def _post_expense_to_ledger(*, expense: Expense, actor_id: uuid.UUID) -> uuid.UUID:
    """Debit the category's expense account, credit the asset it was paid from.

    Tax is posted on the same expense account rather than a separate liability:
    §19 leaves the tenant tax regime unconfirmed, and inventing an input-tax
    account for a school whose jurisdiction may not have one would be a
    guess an auditor has to unpick. Recorded in §20.
    """
    asset_code = _cash_account_for(expense.payment_method or PaymentMethod.BANK_TRANSFER)
    asset = LedgerAccount.objects.alive().get(code=asset_code)
    gross = quantize_money(expense.amount + expense.tax_amount)

    return post_transaction(
        entry_date=expense.expense_date,
        lines=[
            LedgerLine(ledger_account_id=expense.expense_category.ledger_account_id, debit=gross),
            LedgerLine(ledger_account_id=asset.pk, credit=gross),
        ],
        reference_type=LedgerReferenceType.EXPENSE,
        reference_id=expense.pk,
        actor_id=actor_id,
        memo=f"{expense.expense_no}: {expense.description}"[:255],
    )


@transaction.atomic
def mark_expense_paid(*, expense: Expense, actor_id: uuid.UUID) -> Expense:
    """Record that an approved expense has actually left the bank.

    Posts nothing: approval already moved the money in the books, and posting
    again would double-count it. This column exists so a school can tell what
    is committed from what has cleared.
    """
    locked = Expense.objects.select_for_update().get(pk=expense.pk)
    if locked.status != ExpenseStatus.APPROVED:
        raise DomainRuleViolation({"status": "Only an approved expense can be paid."})
    locked.status = ExpenseStatus.PAID
    locked.updated_by = actor_id
    locked.save(update_fields=["status", "updated_by", "updated_at"])
    return locked


@transaction.atomic
def reverse_expense(*, expense: Expense, reason: str, actor_id: uuid.UUID) -> Expense:
    """Undo an approved (or already-paid) expense's ledger posting.

    Approval is what posts to the ledger, and until now nothing could undo
    that: a category picked in error, an amount that was wrong, an expense
    approved by mistake, all stood in the books forever, permanently
    inflating that account's actual spend in every budget-variance and
    income-vs-expense report. A reversal, mirroring `process_refund`'s own
    reasoning — never an edit: the original posting stays exactly as made and
    a new transaction moves the same amounts back, which is what append-only
    means on a ledger.

    `reason` is not stored on the row — `Expense` has no field for it, and
    adding one to carry a single correction's explanation would overload a
    column the schema does not otherwise need — so it goes into the audit
    trail instead, the same choice `Discount.revoke` makes about its own
    reason.
    """
    if not reason.strip():
        raise DomainRuleViolation({"reason": "Reversing an expense requires a reason."})

    locked = Expense.objects.select_for_update().get(pk=expense.pk)
    if locked.status not in (ExpenseStatus.APPROVED, ExpenseStatus.PAID):
        raise DomainRuleViolation({"status": "Only an approved or paid expense can be reversed."})

    original = (
        LedgerEntry.objects.filter(
            reference_type=LedgerReferenceType.EXPENSE, reference_id=locked.pk
        )
        .values_list("transaction_id", flat=True)
        .first()
    )
    if original is None:
        raise DomainRuleViolation({"id": "This expense has no ledger posting to reverse."})

    reverse_transaction(
        transaction_id=original,
        entry_date=timezone.localdate(),
        actor_id=actor_id,
        memo=f"Reversal of {locked.expense_no}: {reason}"[:255],
    )

    locked.status = ExpenseStatus.REVERSED
    locked.updated_by = actor_id
    locked.save(update_fields=["status", "updated_by", "updated_at"])
    return locked


@transaction.atomic
def approve_budget(*, budget: Budget, actor_id: uuid.UUID) -> Budget:
    """Move a budget from draft to approved. §4 puts this with the owner."""
    locked = Budget.objects.select_for_update().get(pk=budget.pk)
    if locked.status != BudgetStatus.DRAFT:
        raise DomainRuleViolation(
            {"status": f"This budget is already {locked.get_status_display().lower()}."}
        )
    locked.status = BudgetStatus.APPROVED
    locked.approved_by = actor_id
    locked.updated_by = actor_id
    locked.save(update_fields=["status", "approved_by", "updated_by", "updated_at"])
    return locked


def allocate_expense_no(*, tenant_id: uuid.UUID, on_date: datetime.date) -> str:
    """A gapless expense number, through the same primitive as invoices.

    Gapless because an expense register with holes in it is the second thing an
    auditor asks about, after the receipt book.
    """
    return numbering.allocate_expense_no(tenant_id=tenant_id, on_date=on_date)


def _ledger_report_queryset(*, user, permission: str | AnyOf) -> models.QuerySet[LedgerEntry]:
    """`LedgerEntry.objects`, scoped for `income-vs-expense` and `trial-balance`.

    `scope_queryset(..., campus_field=None)` correctly fails `own`/`assigned`
    scope closed to `.none()` — `LedgerEntry` defines neither hook — but for
    `campus` scope, `campus_field=None` means something different: it is
    `scope_queryset`'s signal that *the table itself is campus-agnostic*
    (classes, subjects — one definition every campus shares), so a
    campus-scoped caller passes through unfiltered. That is the wrong call
    here. `ledger_entries` has no campus column not because income and
    expense are campus-agnostic — they plainly are not — but because nothing
    records which campus a posting belongs to. Passing a campus-scoped
    caller through on that technicality would show them the whole tenant's
    P&L, which is the exact leak a real per-campus P&L report exists to
    avoid. Refused the same way `own`/`assigned` already is: no correct
    narrowing exists, so the caller sees nothing rather than everything.

    A caller with an `all`-scoped role granting `permission` still passes, as
    `scope_queryset` would pass them: both read only the roles that grant the
    report's key, so an `all` role granting something else does not count, and
    this only narrows the one case `scope_queryset` otherwise gets backwards.
    """
    from core.rbac.models import RecordScope
    from core.rbac.permissions import scope_queryset, scopes_for

    scopes = scopes_for(user, permission)
    if RecordScope.CAMPUS in scopes and RecordScope.ALL not in scopes:
        return LedgerEntry.objects.none()
    # `.all()`: an `all` scope returns the input unchanged, and the summary ANDs two of these.
    return scope_queryset(LedgerEntry.objects.all(), user, permission=permission, campus_field=None)


def build_report_rows(
    *,
    kind: str,
    user,
    permission: str | AnyOf,
    date_from: datetime.date,
    date_to: datetime.date,
    student_id: uuid.UUID | None = None,
    group_by: str = "day",
    limit: int | None = None,
) -> list[dict]:
    """Run one §13 report with the caller's record scope for `permission` applied.

    `permission` is the declaration the request was admitted on (the job carries it
    as `scope_permission`), so only the roles granting it count.

    **The scope is resolved here, from the user**, and the same function serves
    the inline endpoint and the export job. That is deliberate: an export must
    not widen what its requester could see inline, which it would if the job
    re-queried the tables without the scope the endpoint applied. Attendance's
    export task documents the same reasoning.

    Each model's `campus_field` is spelled out because none of these tables
    carries a `campus_id` of its own — an invoice's campus is its student's, an
    expense's is on the row. Left at `scope_queryset`'s default, every
    campus-scoped caller would get a `FieldError`, which is the bug
    `LeaveTypeViewSet` documents.

    `income-vs-expense` and `trial-balance` go through `_ledger_report_queryset`
    below rather than a bare `scope_queryset` call — see its docstring for why
    `campus_field=None` is right for `own`/`assigned` scope here and wrong for
    `campus` scope, which is the opposite of every other table in this
    function.
    """
    from core.rbac.permissions import scope_queryset

    if kind not in reports.REPORT_KINDS:
        raise DomainRuleViolation(
            {"kind": f"Unknown report. Expected one of: {', '.join(reports.REPORT_KINDS)}."}
        )

    def scoped(queryset, campus_field: str = "student__campus_id"):
        return scope_queryset(queryset, user, permission=permission, campus_field=campus_field)

    if kind == "collection":
        return reports.collection_report(
            scoped(Payment.objects.alive()),
            date_from=date_from,
            date_to=date_to,
            group_by=group_by,
            limit=limit,
        )
    if kind == "outstanding-aging":
        return reports.outstanding_and_aging(
            scoped(FeeInvoice.objects.alive()),
            as_of=date_to,
            limit=limit,
        )
    if kind == "student-ledger":
        if student_id is None:
            raise DomainRuleViolation({"student": "A student ledger needs the student it is for."})
        return reports.student_ledger(
            student_id=student_id,
            invoices=scoped(FeeInvoice.objects.alive()),
            payments=scoped(Payment.objects.alive()),
            refunds=scoped(Refund.objects.alive()),
            limit=limit,
        )
    if kind == "grant-register":
        return reports.grant_and_waiver_register(
            discounts=scoped(Discount.objects.alive()),
            scholarships=scoped(Scholarship.objects.alive()),
            fines=scoped(Fine.objects.alive()),
            limit=limit,
        )
    if kind == "income-vs-expense":
        return reports.income_vs_expense(
            _ledger_report_queryset(user=user, permission=permission),
            date_from=date_from,
            date_to=date_to,
            limit=limit,
        )
    if kind == "budget-variance":
        return reports.budget_variance(
            scoped(Budget.objects.alive(), campus_field="campus_id"),
            as_of=date_to,
            limit=limit,
        )
    if kind == "expense-register":
        return reports.expense_register(
            scoped(Expense.objects.alive(), campus_field="campus_id"),
            date_from=date_from,
            date_to=date_to,
            limit=limit,
        )
    return reports.trial_balance_extract(
        _ledger_report_queryset(user=user, permission=permission),
        date_from=date_from,
        date_to=date_to,
        limit=limit,
    )


# ------------------------------------------------------- AI report summaries

#: The report's read key. A summary is scoped by it as well as by the route's own
#: key, so it never shows figures the caller could not open as the report (ADR-0031
#: decision 3).
REPORT_VIEW_KEY = "fees.report.view"


@dataclass(frozen=True)
class ReportSummary:
    summary: str
    facts: dict[str, str]
    model: str
    prompt_version: str
    ai_request_id: uuid.UUID
    budget_warning: bool


def _money(value: Decimal, currency: str) -> str:
    amount = f"{quantize_money(value):,.2f}"
    return f"{currency} {amount}" if currency else amount


def _label(value: object) -> str:
    """An enum value as a reader writes it: `bank_transfer` becomes `bank transfer`."""
    return str(value or "").replace("_", " ")


def _cashier_names(user_ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    """Staff display names for the cashiers' user ids, one query. Never sent to the
    provider: they are what `Cashier-N` is restored to after validation."""
    from apps.staff_management.models import Staff

    return {
        row["user_id"]: f"{row['first_name']} {row['last_name']}".strip()
        for row in Staff.objects.alive()
        .filter(user_id__in=user_ids)
        .values("user_id", "first_name", "last_name")
    }


def report_summary_facts(
    *,
    kind: str,
    user: Any,
    permission: str | AnyOf,
    date_from: datetime.date,
    date_to: datetime.date,
    group_by: str = "day",
    currency: str = "",
) -> SummaryFacts:
    """The facts and table an AI summary of one §13 report reads (AI-FEE-02).

    **Aggregates over the caller's scoped set, never the inline rows**: the facts
    cover every row the caller may see, however many, and the table is grouped
    (by day, method, cashier, account, category, status) and cut to
    `ai.MAX_TABLE_ROWS`. A school with more families owing than the inline
    report's cap still gets its summary.

    Each queryset is scoped by the report's read key and by `permission`, the
    route's own key, so a summary reaches only rows both grant. Only what
    `ai.CONTEXT_ALLOWLIST` names is sent on; cashiers and budgets are aliased
    through the returned `pseudonymizer`. `student-ledger` is refused: it is one
    family's statement.
    """
    from core.rbac.permissions import scope_queryset

    if kind in ai.REFUSED_KINDS:
        raise DomainRuleViolation(
            {"kind": "A student ledger is one family's statement and is not summarised."}
        )
    if kind not in reports.REPORT_KINDS:
        raise DomainRuleViolation(
            {"kind": f"Unknown report. Expected one of: {', '.join(reports.REPORT_KINDS)}."}
        )

    def scoped(queryset: Any, campus_field: str = "student__campus_id") -> Any:
        for key in (REPORT_VIEW_KEY, permission):
            queryset = scope_queryset(queryset, user, permission=key, campus_field=campus_field)
        return queryset

    def ledger() -> models.QuerySet[LedgerEntry]:
        read = _ledger_report_queryset(user=user, permission=REPORT_VIEW_KEY)
        return read & _ledger_report_queryset(user=user, permission=permission)

    names = Pseudonymizer()
    facts: dict[str, str] = {
        "period_start": date_from.isoformat(),
        "period_end": date_to.isoformat(),
    }
    table: list[dict[str, str]] = []
    size_key = "total"
    empty: bool

    if kind == "collection":
        payments = scoped(Payment.objects.alive())
        totals = reports.collection_totals(payments, date_from=date_from, date_to=date_to)
        facts["total_collected"] = _money(totals["total"], currency)
        facts["payment_count"] = str(totals["count"])
        empty = not totals["count"]
        rows = reports.collection_report(
            payments, date_from=date_from, date_to=date_to, group_by=group_by
        )
        cashiers = (
            _cashier_names({row["received_by"] for row in rows if row["received_by"]})
            if group_by == "cashier"
            else {}
        )
        for row in rows:
            entry = {"total": _money(row["total"], currency), "count": str(row["count"])}
            if group_by == "method":
                entry["method"] = _label(row["method"])
            elif group_by == "cashier":
                name = cashiers.get(row["received_by"]) or "an unnamed cashier"
                entry["cashier"] = names.alias("Cashier", name)
            else:
                entry["day"] = row["day"].isoformat()
            table.append(entry)
    elif kind == "outstanding-aging":
        aging = reports.aging_totals(scoped(FeeInvoice.objects.alive()), as_of=date_to)
        facts |= {
            "total_outstanding": _money(aging["total_outstanding"], currency),
            "invoice_count": str(aging["invoice_count"]),
            "student_count": str(aging["student_count"]),
            "not_yet_due": _money(aging["not_yet_due"], currency),
            "overdue_0_30": _money(aging["bucket_0_30"], currency),
            "overdue_31_60": _money(aging["bucket_31_60"], currency),
            "overdue_61_90": _money(aging["bucket_61_90"], currency),
            "overdue_90_plus": _money(aging["bucket_90_plus"], currency),
        }
        empty = not aging["invoice_count"]
    elif kind == "grant-register":
        register = reports.grant_register_counts(
            discounts=scoped(Discount.objects.alive()),
            scholarships=scoped(Scholarship.objects.alive()),
            fines=scoped(Fine.objects.alive()),
        )
        counts = {"discount": 0, "scholarship": 0}
        for row in register["rows"]:
            counts[row["kind"]] = counts.get(row["kind"], 0) + row["count"]
            table.append(
                {"kind": row["kind"], "status": _label(row["status"]), "count": str(row["count"])}
            )
        facts |= {
            "discount_count": str(counts["discount"]),
            "scholarship_count": str(counts["scholarship"]),
            "fine_waiver_count": str(register["fine_waiver_count"]),
            "fine_waived_total": _money(register["fine_waived_total"], currency),
        }
        size_key = "count"
        empty = not table
    elif kind == "income-vs-expense":
        accounts = reports.income_vs_expense(ledger(), date_from=date_from, date_to=date_to)
        net_by_type: dict[str, Decimal] = {}
        for row in accounts:
            account_type = row["ledger_account__account_type"]
            net_by_type[account_type] = net_by_type.get(account_type, ZERO) + row["net"]
        income = net_by_type.get(LedgerAccountType.INCOME, ZERO)
        expense = net_by_type.get(LedgerAccountType.EXPENSE, ZERO)
        facts |= {
            "total_income": _money(income, currency),
            "total_expense": _money(expense, currency),
            "net_result": _money(income - expense, currency),
        }
        table = [
            {
                "account": row["ledger_account__name"],
                "account_type": _label(row["ledger_account__account_type"]),
                "net": _money(row["net"], currency),
            }
            for row in accounts
        ]
        size_key = "net"
        empty = not accounts
    elif kind == "budget-variance":
        budgets = reports.budget_variance(
            scoped(Budget.objects.alive(), campus_field="campus_id"), as_of=date_to
        )
        facts |= {
            "budget_count": str(len(budgets)),
            "total_budgeted": _money(sum((b["budgeted"] for b in budgets), ZERO), currency),
            "total_actual": _money(sum((b["actual"] for b in budgets), ZERO), currency),
            "total_variance": _money(sum((b["variance"] for b in budgets), ZERO), currency),
            "over_budget_count": str(sum(1 for b in budgets if b["variance"] < 0)),
        }
        table = [
            {
                "budget": names.alias("Budget", row["name"]),
                "period_start": row["period_start"].isoformat(),
                "period_end": row["period_end"].isoformat(),
                "budgeted": _money(row["budgeted"], currency),
                "actual": _money(row["actual"], currency),
                "variance": _money(row["variance"], currency),
                "utilisation_percent": f"{row['utilisation_percent']}%",
            }
            for row in budgets
        ]
        size_key = "budgeted"
        empty = not budgets
    elif kind == "expense-register":
        groups = reports.expense_totals(
            scoped(Expense.objects.alive(), campus_field="campus_id"),
            date_from=date_from,
            date_to=date_to,
        )
        facts |= {
            "expense_count": str(sum(row["count"] for row in groups)),
            "total_amount": _money(sum((row["total"] for row in groups), ZERO), currency),
            "total_tax": _money(sum((row["tax"] for row in groups), ZERO), currency),
        }
        table = [
            {
                "category": row["expense_category__name"] or "uncategorised",
                "status": _label(row["status"]),
                "count": str(row["count"]),
                "total": _money(row["total"], currency),
                "tax": _money(row["tax"], currency),
            }
            for row in groups
        ]
        empty = not groups
    else:  # trial-balance
        balances = reports.trial_balance_extract(ledger(), date_from=date_from, date_to=date_to)
        debit = sum((row["total_debit"] for row in balances), ZERO)
        credit = sum((row["total_credit"] for row in balances), ZERO)
        facts |= {
            "total_debit": _money(debit, currency),
            "total_credit": _money(credit, currency),
            "difference": _money(debit - credit, currency),
        }
        table = [
            {
                "account": row["name"],
                "account_type": _label(row["account_type"]),
                "debit": _money(row["total_debit"], currency),
                "credit": _money(row["total_credit"], currency),
                "balance": _money(row["balance"], currency),
            }
            for row in balances
        ]
        size_key = "balance"
        empty = not balances

    shown = ai.downsample(table, size_key=size_key)
    facts["row_count"] = str(len(table))
    facts["rows_shown"] = str(len(shown))
    digest = hashlib.sha256(
        json.dumps({"kind": kind, "facts": facts, "table": shown}, sort_keys=True).encode()
    ).hexdigest()
    return SummaryFacts(
        facts=facts,
        table=shown,
        input_ref=f"sha256:{digest}",
        is_empty=empty,
        pseudonymizer=names,
    )


def summarize_report(*, kind: str, summary: SummaryFacts, user: Any, tenant: Any) -> ReportSummary:
    """Ask the gateway for the summary. Call with **no transaction open**: the gateway
    calls the provider outside one and commits its audit row in its own
    (`core.ai.service`). An empty report records an `ok` row and calls nothing."""
    from core.ai.service import run_feature

    context = ai.build_summary_context(kind=kind, summary=summary)
    run = run_feature(
        feature_key=ai.FEATURE_KEY,
        user=user,
        tenant=tenant,
        user_prompt=context.user_prompt,
        input_ref=summary.input_ref,
        grounding=context.grounding,
        pseudonymizer=summary.pseudonymizer,
        empty_input=summary.is_empty,
    )
    return ReportSummary(
        summary=run.text,
        facts=context.grounding.facts,
        model=run.model,
        prompt_version=run.prompt_version,
        ai_request_id=run.request_id,
        budget_warning=run.budget_warning,
    )


# ---------------------------------------------------------------- visibility

#: An invoice has no campus of its own; its student's is the one record scope reads.
INVOICE_CAMPUS_FIELD = "student__campus_id"
INVOICE_VIEW_KEY = "fees.invoice.view"


def visible_invoices(user, *, queryset: models.QuerySet[FeeInvoice] | None = None):
    """The invoices `user` may read: record scope, then drafts hidden from a student or guardian.

    A draft is a working document the accountant has not handed over, and showing a
    parent a charge that may still change is worse than showing them nothing.
    `queryset` is a caller's already-scoped set (`FeeInvoiceViewSet` passes its
    own, scoped by the route's key); without one, the view key's scope is applied.
    """
    from core.rbac.permissions import is_restricted_principal, scope_queryset

    if queryset is None:
        queryset = scope_queryset(
            FeeInvoice.objects.alive(),
            user,
            permission=INVOICE_VIEW_KEY,
            campus_field=INVOICE_CAMPUS_FIELD,
        )
    if is_restricted_principal(user):
        return queryset.exclude(status=InvoiceStatus.DRAFT)
    return queryset


def outstanding_invoices(queryset: models.QuerySet[FeeInvoice]) -> models.QuerySet[FeeInvoice]:
    """§13's defaulter rule: still owing money, and not canceled.

    `status` alone cannot express it: a partially-paid invoice owes a balance,
    while an overdue one with a zero balance does not.
    """
    return queryset.filter(balance_due__gt=0).exclude(status=InvoiceStatus.CANCELED)
