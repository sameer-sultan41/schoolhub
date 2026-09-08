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
import uuid
from collections.abc import Sequence

from django.db import models, transaction
from django.utils import timezone

from apps.fees_finance import invoicing, numbering
from apps.fees_finance.ledger import LedgerLine, post_transaction, reverse_transaction
from apps.fees_finance.models import (
    Discount,
    DiscountStatus,
    FeeHead,
    FeeInvoice,
    FeeInvoiceLine,
    FeeSchedule,
    FeeStructure,
    FeeStructureStatus,
    FeeVoucher,
    Fine,
    FineStatus,
    ImportStatus,
    InvoiceLineSource,
    InvoiceStatus,
    LedgerAccount,
    LedgerAccountType,
    LedgerEntry,
    LedgerReferenceType,
    Payment,
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
from core.api.exceptions import DomainRuleViolation
from core.money import ZERO, quantize_money

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
    ordered = sorted(shares.items(), key=lambda item: item[1], reverse=True)
    for index, (account_id, share) in enumerate(ordered):
        if index == len(ordered) - 1:
            portion = quantize_money(payment.amount - allocated)
        else:
            portion = quantize_money(payment.amount * share / charged)
            allocated = quantize_money(allocated + portion)
        if portion > ZERO:
            credits.append(LedgerLine(ledger_account_id=account_id, credit=portion))

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
    """
    locked = FeeInvoice.objects.select_for_update().get(pk=invoice.pk)
    amount = quantize_money(amount)

    if locked.status == InvoiceStatus.CANCELED:
        raise DomainRuleViolation(
            {"fee_invoice": f"{locked.invoice_no} is canceled and takes no payment."}
        )
    if amount <= ZERO:
        raise DomainRuleViolation({"amount": "A payment must be for a positive amount."})
    if amount > locked.balance_due:
        # §11's default. Advance payment is a §19 recommendation and is not
        # built — see §20.
        raise DomainRuleViolation(
            {
                "amount": (
                    f"{amount} exceeds the {locked.balance_due} outstanding on {locked.invoice_no}."
                )
            },
            meta={"balance_due": str(locked.balance_due)},
        )

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
    return payment


@transaction.atomic
def confirm_payment(
    *, payment: Payment, actor_id: uuid.UUID | None, tenant_id: uuid.UUID
) -> Payment:
    """Move a payment to confirmed, issuing its receipt and posting the ledger.

    Split from `record_payment` because a gateway payment is created `pending`
    and confirmed later by a webhook — the same work, arriving through a
    different door, which is exactly the case AGENTS.md's "rules live in
    services" exists for.

    Idempotent on the payment's status: confirming an already-confirmed payment
    returns it untouched rather than issuing a second receipt. A retried webhook
    is a normal event, not an error.
    """
    locked = Payment.objects.select_for_update().select_related("fee_invoice").get(pk=payment.pk)
    if locked.status == PaymentStatus.CONFIRMED and hasattr(locked, "receipt"):
        return locked
    if locked.status == PaymentStatus.REVERSED:
        raise DomainRuleViolation({"status": "A reversed payment cannot be confirmed."})

    invoice = FeeInvoice.objects.select_for_update().get(pk=locked.fee_invoice_id)

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
    original_lines = list(LedgerEntry.objects.filter(transaction_id=original_transaction_id))
    total_debit = quantize_money(sum((line.debit for line in original_lines), ZERO))
    share = refund.amount / total_debit if total_debit else ZERO

    lines = []
    allocated = ZERO
    scaled = [
        (line, quantize_money((line.debit or line.credit) * share)) for line in original_lines
    ]
    for index, (line, portion) in enumerate(scaled):
        if index == len(scaled) - 1:
            # The last line absorbs the rounding remainder so the posting
            # balances exactly — `assert_balanced` is about to insist.
            portion = quantize_money(refund.amount - allocated) if line.credit else portion
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
      settlement path gets the same balance check, receipt, ledger posting and
      total recomputation as a payment taken at a counter, or the two would
      drift.
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

        payment = record_payment(
            invoice=voucher.fee_invoice,
            amount=row.amount,
            method=PaymentMethod.BANK_TRANSFER,
            reference_no=row.transaction_reference,
            gateway_provider=None,
            # No `received_by`: nobody at the school handled this money.
            actor_id=None,
            tenant_id=tenant_id,
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
