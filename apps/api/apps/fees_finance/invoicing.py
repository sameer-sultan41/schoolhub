"""Draft-invoice arithmetic: schedules and grants in, lines and totals out.

Pure functions with **no queries and no model writes**. Everything a decision
needs is passed in, so `services.generate_invoices` can fetch once for a whole
session and compute a school's billing in memory — the shape
`examinations/processing.py` uses, and for the same reason: one query per student
is what turns a 2000-student billing run into a timeout.

Three rules live here because they are arithmetic rather than storage:

* **Which schedules a period owes.** A monthly line is due every month, a
  per-term line only in its term, an annual or one-time line only on its date.
* **Proration.** A student enrolled mid-month owes part of that month.
* **Grant application, and the order it happens in.** Scholarships apply before
  discounts, and both are clamped so no line can go below zero.
"""

from __future__ import annotations

import calendar
import datetime
import uuid
from dataclasses import dataclass, field
from decimal import Decimal

from apps.fees_finance.models import (
    DiscountStatus,
    FeeFrequency,
    GrantValueType,
    InvoiceLineSource,
    ScholarshipStatus,
)
from core.money import ZERO, quantize_money

#: Scholarship statuses that actually reduce a bill. `applied` has not been
#: decided and `ended`/`revoked` no longer apply — billing on an `applied` award
#: would hand a student a reduction the school never granted.
BILLABLE_SCHOLARSHIP_STATUSES = frozenset({ScholarshipStatus.APPROVED, ScholarshipStatus.ACTIVE})


@dataclass
class DraftLine:
    """One prospective invoice line, before it becomes a row."""

    fee_head_id: uuid.UUID
    description: str
    amount: Decimal
    source_type: str
    source_id: uuid.UUID | None = None
    discount_amount: Decimal = ZERO


@dataclass
class DraftInvoice:
    """The whole computed invoice, header totals included."""

    lines: list[DraftLine] = field(default_factory=list)
    subtotal: Decimal = ZERO
    discount_total: Decimal = ZERO
    fine_total: Decimal = ZERO
    due_date: datetime.date | None = None

    @property
    def balance_due(self) -> Decimal:
        return quantize_money(self.subtotal - self.discount_total + self.fine_total)


def period_label(*, frequency: str, period_start: datetime.date, term_name: str | None) -> str:
    """The human-readable period, and half of the duplicate guard.

    Monthly bills are labelled `YYYY-MM` and per-term ones by the term's name,
    because those are the two things a parent recognises on a statement. The
    label is part of the uniqueness key, so it has to be *derived* rather than
    typed: a hand-entered "Sept 2026" alongside a generated "2026-09" would let
    the same month be billed twice.
    """
    if frequency == FeeFrequency.MONTHLY:
        return period_start.strftime("%Y-%m")
    if frequency == FeeFrequency.PER_TERM:
        return term_name or period_start.strftime("%Y-%m")
    return str(period_start.year)


def due_date_for(
    *, schedule, period_start: datetime.date, term_end: datetime.date | None
) -> datetime.date:
    """When a schedule's charge for this period falls due.

    `due_day` is constrained to 1-28 so it exists in every month, but the clamp
    stays here anyway: a school migrating data or a future relaxation of that
    constraint should not produce a `ValueError` deep inside a billing job.
    """
    if schedule.frequency == FeeFrequency.MONTHLY:
        last_day = calendar.monthrange(period_start.year, period_start.month)[1]
        day = min(schedule.due_day or 1, last_day)
        return period_start.replace(day=day)
    if schedule.frequency == FeeFrequency.PER_TERM:
        # A term's charge is due at its end unless the school said otherwise;
        # falling back to the period start keeps a term with no recorded end
        # date out of the aging report's "no due date" hole.
        return term_end or period_start
    return schedule.due_date or period_start


def schedule_applies_to_period(
    *,
    schedule,
    period_start: datetime.date,
    period_end: datetime.date,
    term_id: uuid.UUID | None = None,
) -> bool:
    """Whether this schedule owes anything for the given period.

    The rule the whole generator turns on. A monthly line applies to every
    period; a per-term line only to its own term; a one-time or annual line only
    to the period containing its fixed due date — which is what stops an annual
    charge being billed twelve times.
    """
    if schedule.frequency == FeeFrequency.MONTHLY:
        return True
    if schedule.frequency == FeeFrequency.PER_TERM:
        return term_id is not None and schedule.term_id == term_id
    if schedule.due_date is None:
        return False
    return period_start <= schedule.due_date <= period_end


def proration_factor(
    *,
    frequency: str,
    period_start: datetime.date,
    period_end: datetime.date,
    enrolled_from: datetime.date | None,
) -> Decimal:
    """The fraction of a period a student was actually enrolled for.

    §6 asks for "proration on mid-term enrollment". Applied only to *recurring*
    charges: a one-time admission fee is not half-owed by a student who joined
    mid-month, and prorating it would be a discount nobody granted.

    Counted in days inclusive of both ends, so a student joining on the last day
    of a 30-day month owes 1/30 rather than nothing — a zero-value line is
    harder to explain to a parent than a small one.
    """
    if frequency not in {FeeFrequency.MONTHLY, FeeFrequency.PER_TERM}:
        return Decimal("1")
    if enrolled_from is None or enrolled_from <= period_start:
        return Decimal("1")
    if enrolled_from > period_end:
        return ZERO

    total_days = (period_end - period_start).days + 1
    charged_days = (period_end - enrolled_from).days + 1
    return Decimal(charged_days) / Decimal(total_days)


def _grant_amount(*, value_type: str, value: Decimal, base: Decimal) -> Decimal:
    if value_type == GrantValueType.PERCENT:
        return quantize_money(base * value / Decimal("100"))
    return quantize_money(value)


def discount_applies(*, discount, on_date: datetime.date, fee_head_id: uuid.UUID) -> bool:
    """Whether a grant is live on `on_date` and covers this head.

    `fee_head_id` NULL on the grant means every head. The validity window is
    checked here rather than trusted from `status`, because `status` is moved by
    a sweep and a school billing on the 1st should not depend on the sweep
    having run — the dates are the truth, the status is the convenience.
    """
    if discount.status != DiscountStatus.ACTIVE:
        return False
    if discount.valid_from is not None and on_date < discount.valid_from:
        return False
    if discount.valid_to is not None and on_date > discount.valid_to:
        return False
    return discount.fee_head_id is None or discount.fee_head_id == fee_head_id


def apply_grants(
    *,
    lines: list[DraftLine],
    discounts: list,
    scholarships: list,
    on_date: datetime.date,
) -> Decimal:
    """Reduce `lines` in place by the student's grants; return the total reduced.

    **Order matters and is fixed here: scholarships first, then discounts.** A
    scholarship covers a proportion of what a student owes and is the larger,
    externally-sponsored award; applying a sibling discount first would shrink
    the base the scholarship is computed against and quietly reduce what the
    sponsor pays. Stated rather than left to whichever list happened to be
    iterated first.

    Every reduction is clamped to what remains on the line, so no line can go
    below zero — §11's rule, and the CHECK on `fee_invoice_lines` refuses the
    state outright in case this is ever wrong.
    """
    total = ZERO

    for scholarship in scholarships:
        if scholarship.status not in BILLABLE_SCHOLARSHIP_STATUSES:
            continue
        for line in lines:
            remaining = line.amount - line.discount_amount
            if remaining <= ZERO:
                continue
            granted = min(
                _grant_amount(
                    value_type=scholarship.coverage_type,
                    value=scholarship.value,
                    base=line.amount,
                ),
                remaining,
            )
            line.discount_amount = quantize_money(line.discount_amount + granted)
            total += granted

    for discount in discounts:
        for line in lines:
            if not discount_applies(
                discount=discount, on_date=on_date, fee_head_id=line.fee_head_id
            ):
                continue
            remaining = line.amount - line.discount_amount
            if remaining <= ZERO:
                continue
            granted = min(
                _grant_amount(
                    value_type=discount.discount_type, value=discount.value, base=line.amount
                ),
                remaining,
            )
            line.discount_amount = quantize_money(line.discount_amount + granted)
            total += granted

    return quantize_money(total)


def build_draft(
    *,
    schedules: list,
    fines: list,
    discounts: list,
    scholarships: list,
    period_start: datetime.date,
    period_end: datetime.date,
    term_id: uuid.UUID | None = None,
    term_end: datetime.date | None = None,
    enrolled_from: datetime.date | None = None,
    head_names: dict[uuid.UUID, str] | None = None,
) -> DraftInvoice:
    """Compute one student's invoice for one period. No queries.

    Fines are folded in at full value and are never prorated or discounted: a
    late-payment or library charge is a fixed penalty, and reducing it with a
    sibling discount would be a policy nobody wrote down.
    """
    names = head_names or {}
    draft = DraftInvoice()
    due_dates: list[datetime.date] = []

    for schedule in schedules:
        if not schedule_applies_to_period(
            schedule=schedule,
            period_start=period_start,
            period_end=period_end,
            term_id=term_id,
        ):
            continue

        factor = proration_factor(
            frequency=schedule.frequency,
            period_start=period_start,
            period_end=period_end,
            enrolled_from=enrolled_from,
        )
        amount = quantize_money(schedule.amount * factor)
        if amount <= ZERO:
            continue

        label = names.get(schedule.fee_head_id, "Fee")
        description = label if factor == Decimal("1") else f"{label} (prorated)"
        draft.lines.append(
            DraftLine(
                fee_head_id=schedule.fee_head_id,
                description=description,
                amount=amount,
                source_type=InvoiceLineSource.SCHEDULE,
                source_id=schedule.pk,
            )
        )
        due_dates.append(
            due_date_for(schedule=schedule, period_start=period_start, term_end=term_end)
        )

    draft.discount_total = apply_grants(
        lines=draft.lines,
        discounts=discounts,
        scholarships=scholarships,
        on_date=period_start,
    )
    draft.subtotal = quantize_money(sum((line.amount for line in draft.lines), ZERO))

    for fine in fines:
        draft.lines.append(
            DraftLine(
                fee_head_id=fine.fee_head_id,
                description=f"{fine.get_fine_type_display()}: {fine.reason}"[:255],
                amount=quantize_money(fine.amount),
                source_type=InvoiceLineSource.FINE,
                source_id=fine.pk,
            )
        )
    draft.fine_total = quantize_money(sum((quantize_money(f.amount) for f in fines), ZERO))

    # The earliest due date across the period's charges. A single invoice with
    # lines falling due on different days is due on the first of them — anything
    # later would let part of it go quietly overdue outside the aging report.
    draft.due_date = min(due_dates) if due_dates else period_end
    return draft
