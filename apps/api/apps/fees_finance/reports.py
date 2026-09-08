"""§13's reports, as pure query functions.

Separate from `services.py` for the reason `ledger.py` is: this is a
self-contained query engine two callers use — the synchronous endpoint and the
export job — and mixing it into the write path would bury the module's largest
reads.

**No query inside a loop, anywhere in this file.** An aging report over a
school's year is exactly the shape `ENGINEERING_STANDARDS.md` §3's N+1 rule
exists for, and every function here is asserted with `assertNumQueries` so a
later refactor that reintroduces one fails rather than merely slows. Each
returns plain rows — dicts of scalars — so the serializer, the CSV writer and
the PDF renderer all read the same numbers.

Every function takes an **already-scoped queryset** rather than building its
own. §13's closing line gives role visibility, and for money that is not a
cosmetic concern: a report that queried the table directly would show one
family another family's balance. A report is read as authoritative, which is
exactly why it is the worst place to lose record scope.

Aging in particular buckets **in SQL**. A Python loop over a year of invoices
would return the right answer and time out on the school that most needs it.
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from django.db.models import Case, Count, DecimalField, F, Q, QuerySet, Sum, Value, When
from django.db.models.functions import Coalesce, TruncDate
from django.utils import timezone

from apps.fees_finance.models import (
    Budget,
    BudgetStatus,
    Discount,
    Expense,
    FeeInvoice,
    Fine,
    FineStatus,
    InvoiceStatus,
    LedgerAccountType,
    LedgerEntry,
    Payment,
    PaymentStatus,
    Refund,
    RefundStatus,
    Scholarship,
)
from core.money import ZERO, quantize_money

#: §13's aging buckets. Upper bounds in days past the due date; the last bucket
#: is open-ended. Named rather than inlined because the report, the defaulter
#: list and the dashboard all have to agree on where 30 days ends.
AGING_BUCKETS: tuple[tuple[str, int | None], ...] = (
    ("0-30", 30),
    ("31-60", 60),
    ("61-90", 90),
    ("90+", None),
)

_MONEY = DecimalField(max_digits=12, decimal_places=2)
_ZERO = Value(ZERO, output_field=_MONEY)


def _capped(rows, limit: int | None):
    """Apply the caller's row cap as a queryset slice.

    A slice, not a Python truncation: the point of the cap is that the rows are
    never built, so it has to reach SQL as a LIMIT. `None` means unbounded,
    which is what the export job asks for.
    """
    return rows if limit is None else rows[:limit]


def _as_dicts(rows) -> list[dict]:
    """`.values()` yields TypedDict rows; every caller here wants plain dicts."""
    return [dict(row) for row in rows]


def collection_report(
    queryset: QuerySet[Payment],
    *,
    date_from: datetime.date,
    date_to: datetime.date,
    group_by: str = "day",
    limit: int | None = None,
) -> list[dict]:
    """§13.1 — what was collected, by day, method or cashier.

    Only **confirmed** payments. A pending gateway payment in a collection
    report is money the school has not got, and an accountant reconciling
    against a bank statement would spend the afternoon looking for it.

    Each grouping returns from its own branch rather than assigning to a shared
    variable: `.values()` yields a different row shape per grouping, and
    django-stubs types each one distinctly — reassigning would be a type error
    for a real reason, since the three shapes genuinely differ.
    """
    base = queryset.filter(
        status=PaymentStatus.CONFIRMED, paid_at__date__gte=date_from, paid_at__date__lte=date_to
    )

    # The two annotations are written out per branch rather than spread from a
    # shared dict: a `**kwargs` spread hides the annotation names from
    # django-stubs, which then cannot resolve `order_by("-total")`.
    if group_by == "method":
        return _as_dicts(
            _capped(
                base.values("method")
                .annotate(total=Coalesce(Sum("amount"), _ZERO), count=Count("id"))
                .order_by("-total"),
                limit,
            )
        )
    if group_by == "cashier":
        return _as_dicts(
            _capped(
                base.values("received_by")
                .annotate(total=Coalesce(Sum("amount"), _ZERO), count=Count("id"))
                .order_by("-total"),
                limit,
            )
        )
    return _as_dicts(
        _capped(
            base.annotate(day=TruncDate("paid_at"))
            .values("day")
            .annotate(total=Coalesce(Sum("amount"), _ZERO), count=Count("id"))
            .order_by("day"),
            limit,
        )
    )


def outstanding_and_aging(
    queryset: QuerySet[FeeInvoice],
    *,
    as_of: datetime.date | None = None,
    limit: int | None = None,
) -> list[dict]:
    """§13.2 — one row per student, with their balance split into buckets.

    **Bucketed in SQL** with a single `CASE`, so a school's whole receivable
    ledger is one query regardless of how many invoices it holds. The
    alternative — reading every unpaid invoice and bucketing in Python — is the
    timeout, and it is why `test_aging_is_one_query` exists.

    Canceled invoices are excluded, and so are settled ones: a zero balance is
    not an outstanding balance, and including it would make every paid-up family
    appear on the defaulter list at 0.
    """
    today = as_of or timezone.localdate()
    unpaid = queryset.exclude(status=InvoiceStatus.CANCELED).filter(balance_due__gt=0)

    def bucket_sum(lower: int, upper: int | None):
        """One bucket, as a conditional `SUM` over the whole set.

        `default=_ZERO` and `output_field` on the `Case` are both load-bearing:
        without a default every non-matching row contributes NULL, and without
        an explicit output field PostgreSQL cannot infer the type of a `CASE`
        whose branches are all NULL — which is a database error rather than a
        wrong number, but only for the school whose data happens to trigger it.
        """
        overdue_days = Q(due_date__lte=today - datetime.timedelta(days=lower))
        if upper is not None:
            overdue_days &= Q(due_date__gt=today - datetime.timedelta(days=upper))
        return Coalesce(
            Sum(
                Case(
                    When(overdue_days, then=F("balance_due")),
                    default=_ZERO,
                    output_field=_MONEY,
                )
            ),
            _ZERO,
        )

    rows = (
        unpaid.values(
            "student_id", "student__admission_number", "student__first_name", "student__last_name"
        )
        .annotate(
            total_outstanding=Coalesce(Sum("balance_due"), _ZERO),
            invoice_count=Count("id"),
            # Not yet due: everything with a due date still ahead.
            not_yet_due=Coalesce(
                Sum(
                    Case(
                        When(due_date__gt=today, then=F("balance_due")),
                        default=_ZERO,
                        output_field=_MONEY,
                    )
                ),
                _ZERO,
            ),
            bucket_0_30=bucket_sum(0, 30),
            bucket_31_60=bucket_sum(30, 60),
            bucket_61_90=bucket_sum(60, 90),
            bucket_90_plus=bucket_sum(90, None),
        )
        .order_by("-total_outstanding")
    )
    return _as_dicts(_capped(rows, limit))


def student_ledger(
    *,
    student_id,
    invoices: QuerySet[FeeInvoice],
    payments: QuerySet[Payment],
    refunds: QuerySet[Refund],
    limit: int | None = None,
) -> list[dict]:
    """§13.3 — one student's chronological statement.

    Three scoped querysets rather than one, because a statement interleaves
    three different kinds of event and each has its own record scope applied by
    the caller. Merged and sorted in Python — **the only sort in this file that
    is** — because three heterogeneous sources cannot be ordered by SQL without
    a UNION whose columns would have to be forced to match, and a statement is
    one student's history rather than a school-scale scan.
    """
    entries: list[dict] = []

    for invoice in (
        invoices.filter(student_id=student_id)
        .exclude(status=InvoiceStatus.CANCELED)
        .values(
            "id",
            "invoice_no",
            "issue_date",
            "period_label",
            "balance_due",
            "subtotal",
            "discount_total",
            "fine_total",
        )
    ):
        charged = quantize_money(
            invoice["subtotal"] - invoice["discount_total"] + invoice["fine_total"]
        )
        entries.append(
            {
                "date": invoice["issue_date"],
                "kind": "invoice",
                "reference": invoice["invoice_no"],
                "description": invoice["period_label"] or "Fee invoice",
                "debit": charged,
                "credit": ZERO,
            }
        )

    for payment in payments.filter(student_id=student_id, status=PaymentStatus.CONFIRMED).values(
        "id", "amount", "paid_at", "method", "receipt__receipt_no"
    ):
        entries.append(
            {
                "date": payment["paid_at"].date() if payment["paid_at"] else None,
                "kind": "payment",
                "reference": payment["receipt__receipt_no"] or "",
                "description": payment["method"].replace("_", " ").capitalize(),
                "debit": ZERO,
                "credit": quantize_money(payment["amount"]),
            }
        )

    for refund in refunds.filter(student_id=student_id, status=RefundStatus.PROCESSED).values(
        "id", "amount", "processed_at", "reason"
    ):
        entries.append(
            {
                "date": refund["processed_at"].date() if refund["processed_at"] else None,
                "kind": "refund",
                "reference": "",
                "description": f"Refund: {refund['reason']}"[:255],
                "debit": quantize_money(refund["amount"]),
                "credit": ZERO,
            }
        )

    entries.sort(key=lambda row: (row["date"] or datetime.date.min, row["kind"]))

    # A running balance, which is the column a parent actually reads. Computed
    # here rather than in SQL because it depends on the merged order above.
    running = ZERO
    for entry in entries:
        running = quantize_money(running + entry["debit"] - entry["credit"])
        entry["balance"] = running

    return entries if limit is None else entries[:limit]


def grant_and_waiver_register(
    *,
    discounts: QuerySet[Discount],
    scholarships: QuerySet[Scholarship],
    fines: QuerySet[Fine],
    limit: int | None = None,
) -> list[dict]:
    """§13.4 — every reduction granted and every fine waived, with its approver.

    The report an auditor asks for first, which is why `approved_by` /
    `waived_by` is on every row: a reduction nobody is recorded as having
    authorised is the finding, and the CHECKs on those tables exist so this
    report cannot come back with a blank in that column.

    Three sources normalized to one row shape, built field by field rather than
    by spreading each source's own dict. The shapes genuinely differ — a
    scholarship has `coverage_type` where a discount has `discount_type`, and a
    waived fine has neither — so one explicit mapping per source is both what
    the types require and what makes the CSV column order obvious.
    """
    rows: list[dict] = []

    for discount in discounts.values(
        "id",
        "name",
        "discount_type",
        "value",
        "status",
        "approved_by",
        "student__admission_number",
        "created_at",
    ):
        rows.append(
            {
                "id": discount["id"],
                "kind": "discount",
                "name": discount["name"],
                "value_type": discount["discount_type"],
                "value": discount["value"],
                "status": discount["status"],
                "approved_by": discount["approved_by"],
                "admission_number": discount["student__admission_number"],
                "granted_at": discount["created_at"],
            }
        )

    for scholarship in scholarships.values(
        "id",
        "name",
        "coverage_type",
        "value",
        "status",
        "approved_by",
        "student__admission_number",
        "created_at",
    ):
        rows.append(
            {
                "id": scholarship["id"],
                "kind": "scholarship",
                "name": scholarship["name"],
                "value_type": scholarship["coverage_type"],
                "value": scholarship["value"],
                "status": scholarship["status"],
                "approved_by": scholarship["approved_by"],
                "admission_number": scholarship["student__admission_number"],
                "granted_at": scholarship["created_at"],
            }
        )

    for fine in fines.filter(status=FineStatus.WAIVED).values(
        "id",
        "fine_type",
        "amount",
        "status",
        "waived_by",
        "waived_reason",
        "student__admission_number",
        "created_at",
    ):
        rows.append(
            {
                "id": fine["id"],
                "kind": "fine_waiver",
                "name": fine["fine_type"],
                "value_type": "fixed",
                "value": fine["amount"],
                "status": fine["status"],
                "approved_by": fine["waived_by"],
                "admission_number": fine["student__admission_number"],
                "granted_at": fine["created_at"],
            }
        )

    rows.sort(key=lambda row: row["granted_at"], reverse=True)
    return rows if limit is None else rows[:limit]


def income_vs_expense(
    queryset: QuerySet[LedgerEntry],
    *,
    date_from: datetime.date,
    date_to: datetime.date,
    limit: int | None = None,
) -> list[dict]:
    """§13.5 — income and expense by account over a period.

    Read from `ledger_entries`, not from invoices and expenses. That is the
    whole reason the ledger exists: a reversed payment and a rejected expense
    both stop counting automatically, where summing the source documents would
    require every report to know each document's lifecycle.
    """
    rows = (
        queryset.filter(
            entry_date__gte=date_from,
            entry_date__lte=date_to,
            ledger_account__account_type__in=[
                LedgerAccountType.INCOME,
                LedgerAccountType.EXPENSE,
            ],
        )
        .values(
            "ledger_account_id",
            "ledger_account__code",
            "ledger_account__name",
            "ledger_account__account_type",
        )
        .annotate(
            total_debit=Coalesce(Sum("debit"), _ZERO),
            total_credit=Coalesce(Sum("credit"), _ZERO),
        )
        .order_by("ledger_account__account_type", "ledger_account__code")
    )

    out = []
    for row in _capped(rows, limit):
        # Income accounts are credited and expense accounts debited, so the
        # meaningful figure is the natural balance of each — reported as a
        # positive number in both cases, because "income: -50,000" is a report
        # nobody reads correctly.
        if row["ledger_account__account_type"] == LedgerAccountType.INCOME:
            net = row["total_credit"] - row["total_debit"]
        else:
            net = row["total_debit"] - row["total_credit"]
        out.append({**dict(row), "net": quantize_money(net)})
    return out


def budget_variance(
    queryset: QuerySet[Budget],
    *,
    as_of: datetime.date | None = None,
    limit: int | None = None,
) -> list[dict]:
    """§13.5's second half — planned against actual, per budget.

    Actuals come from posted ledger entries in the budget's own period, which is
    what makes a reversed expense stop counting against it. Two queries: the
    budgets, then one aggregate over the entries for all of their accounts —
    never one query per budget.

    **Keyed on `(account, period)`, not on the account alone.** Two budgets can
    legitimately target the same account with different periods —
    `budgets_one_per_target_and_period` only requires the *pair* to be unique —
    and pooling every account's spend into one tenant-wide-date-range figure
    would hand a Q1 budget the same "actual" as a Q2 budget on the same
    account. A conditional `Sum` per distinct period keeps this at one query
    regardless of how many periods appear among the (capped) budget set.

    **Not keyed on campus.** `ledger_entries` carries no campus column — see
    `LedgerEntryViewSet.get_queryset`'s docstring for why — so two
    campus-scoped budgets on the same account and period (the constraint
    allows exactly that, differentiated by `campus_id`) still read the same,
    tenant-wide actual. Recorded rather than silently wrong: fixing it needs a
    campus dimension on the ledger itself, which is out of scope here.
    """
    today = as_of or timezone.localdate()
    budgets = list(
        _capped(
            queryset.filter(status=BudgetStatus.APPROVED)
            .select_related("ledger_account", "expense_category")
            .order_by("period_start", "name"),
            limit,
        )
    )
    if not budgets:
        return []

    account_ids = {
        budget.ledger_account_id
        or (budget.expense_category.ledger_account_id if budget.expense_category else None)
        for budget in budgets
    }
    account_ids.discard(None)

    periods = sorted({(budget.period_start, budget.period_end) for budget in budgets})
    period_index = {period: index for index, period in enumerate(periods)}
    period_annotations = {
        f"spent_{index}": Coalesce(
            Sum(
                Case(
                    When(
                        entry_date__gte=period_start,
                        entry_date__lte=min(today, period_end),
                        then=F("debit") - F("credit"),
                    ),
                    default=_ZERO,
                    output_field=_MONEY,
                )
            ),
            _ZERO,
        )
        for index, (period_start, period_end) in enumerate(periods)
    }

    spend = {
        row["ledger_account_id"]: row
        for row in LedgerEntry.objects.filter(
            ledger_account_id__in=account_ids,
            entry_date__gte=min(period_start for period_start, _ in periods),
            entry_date__lte=min(today, max(period_end for _, period_end in periods)),
        )
        .values("ledger_account_id")
        .annotate(**period_annotations)
    }

    rows = []
    for budget in budgets:
        account_id = budget.ledger_account_id or (
            budget.expense_category.ledger_account_id if budget.expense_category else None
        )
        period_key = f"spent_{period_index[(budget.period_start, budget.period_end)]}"
        actual = quantize_money(spend.get(account_id, {}).get(period_key, ZERO))
        rows.append(
            {
                "budget_id": str(budget.pk),
                "name": budget.name,
                "period_start": budget.period_start,
                "period_end": budget.period_end,
                "budgeted": budget.amount,
                "actual": actual,
                "variance": quantize_money(budget.amount - actual),
                "utilisation_percent": (
                    quantize_money(actual / budget.amount * Decimal("100"))
                    if budget.amount
                    else ZERO
                ),
            }
        )
    return rows


def expense_register(
    queryset: QuerySet[Expense],
    *,
    date_from: datetime.date,
    date_to: datetime.date,
    limit: int | None = None,
) -> list[dict]:
    """§13's expense side — what was spent, on what, approved by whom.

    Includes every status so a school can see what is pending as well as what
    is committed; `status` is a column on the row rather than a filter baked in,
    because "what is waiting on me?" and "what did we spend?" are the same
    report to an accountant.
    """
    rows = (
        queryset.filter(expense_date__gte=date_from, expense_date__lte=date_to)
        .values(
            "id",
            "expense_no",
            "expense_date",
            "vendor_name",
            "description",
            "amount",
            "tax_amount",
            "status",
            "approved_by",
            "expense_category__code",
            "expense_category__name",
            "campus__name",
        )
        .order_by("-expense_date", "expense_no")
    )
    return _as_dicts(_capped(rows, limit))


def trial_balance_extract(
    queryset: QuerySet[LedgerEntry],
    *,
    date_from: datetime.date,
    date_to: datetime.date,
    limit: int | None = None,
) -> list[dict]:
    """§13.6 — delegates to `ledger.trial_balance`.

    A thin wrapper on purpose: the trial balance is the ledger's own view of
    itself and belongs beside the posting engine, so having two implementations
    of "what does each account total" is exactly the drift this module avoids
    elsewhere. The scoped `queryset` is passed straight through rather than
    re-derived, so this report and `income_vs_expense` share one scoping story.
    """
    from apps.fees_finance.ledger import trial_balance

    rows = trial_balance(queryset=queryset, date_from=date_from, date_to=date_to)
    return rows if limit is None else rows[:limit]


#: The `kind` values `GET /reports/finance-summary` accepts, mapped to the
#: function that answers each. A dict rather than a chain of `if`s so
#: `test_every_declared_kind_is_answerable` can walk it — a kind the endpoint
#: advertises and cannot serve is worse than one it does not advertise.
REPORT_KINDS = {
    "collection": collection_report,
    "outstanding-aging": outstanding_and_aging,
    "student-ledger": student_ledger,
    "grant-register": grant_and_waiver_register,
    "income-vs-expense": income_vs_expense,
    "budget-variance": budget_variance,
    "expense-register": expense_register,
    "trial-balance": trial_balance_extract,
}
