"""The billing arithmetic, tested without a database.

`invoicing.py` is pure — no queries, no writes — so these are `SimpleTestCase`
cases over stub objects. That is the point of the split: the rules a school
argues about (which period owes what, how a mid-month joiner is charged, which
grant applies first) are checkable without building a school.

The cases worth reading twice are the ones about *order and clamping*.
Scholarships apply before discounts, and every reduction is clamped to what
remains on the line — get either wrong and the school either bills a negative
amount or quietly reduces what a sponsor pays.
"""

from __future__ import annotations

import datetime
import uuid
from dataclasses import dataclass
from decimal import Decimal

from django.test import SimpleTestCase

from apps.fees_finance import invoicing
from apps.fees_finance.models import (
    DiscountStatus,
    FeeFrequency,
    GrantValueType,
    ScholarshipStatus,
)

SEP = datetime.date(2026, 9, 1)
SEP_END = datetime.date(2026, 9, 30)
TUITION = uuid.uuid4()
TRANSPORT = uuid.uuid4()


@dataclass
class StubSchedule:
    amount: Decimal
    frequency: str = FeeFrequency.MONTHLY
    term_id: object = None
    due_day: int | None = 10
    due_date: datetime.date | None = None
    fee_head_id: object = TUITION
    pk: object = None

    def __post_init__(self) -> None:
        if self.pk is None:
            self.pk = uuid.uuid4()


@dataclass
class StubGrant:
    value: Decimal
    discount_type: str = GrantValueType.PERCENT
    coverage_type: str = GrantValueType.PERCENT
    status: str = DiscountStatus.ACTIVE
    fee_head_id: object = None
    valid_from: datetime.date | None = None
    valid_to: datetime.date | None = None


@dataclass
class StubFine:
    amount: Decimal
    fee_head_id: object = TUITION
    reason: str = "Overdue book"
    pk: object = None

    def __post_init__(self) -> None:
        if self.pk is None:
            self.pk = uuid.uuid4()

    def get_fine_type_display(self) -> str:
        return "Library"


class PeriodSelectionTests(SimpleTestCase):
    def test_a_monthly_schedule_applies_to_every_period(self) -> None:
        self.assertTrue(
            invoicing.schedule_applies_to_period(
                schedule=StubSchedule(Decimal("100.00")),
                period_start=SEP,
                period_end=SEP_END,
            )
        )

    def test_an_annual_schedule_applies_only_to_the_period_holding_its_due_date(self) -> None:
        """The rule that stops an annual charge being billed twelve times."""
        annual = StubSchedule(
            Decimal("5000.00"),
            frequency=FeeFrequency.ANNUAL,
            due_day=None,
            due_date=datetime.date(2026, 9, 15),
        )

        self.assertTrue(
            invoicing.schedule_applies_to_period(
                schedule=annual, period_start=SEP, period_end=SEP_END
            )
        )
        self.assertFalse(
            invoicing.schedule_applies_to_period(
                schedule=annual,
                period_start=datetime.date(2026, 10, 1),
                period_end=datetime.date(2026, 10, 31),
            )
        )

    def test_a_per_term_schedule_applies_only_to_its_own_term(self) -> None:
        term_a, term_b = uuid.uuid4(), uuid.uuid4()
        schedule = StubSchedule(
            Decimal("3000.00"),
            frequency=FeeFrequency.PER_TERM,
            term_id=term_a,
            due_day=None,
        )

        self.assertTrue(
            invoicing.schedule_applies_to_period(
                schedule=schedule, period_start=SEP, period_end=SEP_END, term_id=term_a
            )
        )
        self.assertFalse(
            invoicing.schedule_applies_to_period(
                schedule=schedule, period_start=SEP, period_end=SEP_END, term_id=term_b
            )
        )

    def test_a_per_term_schedule_in_a_monthly_run_applies_to_nothing(self) -> None:
        """A monthly run passes no term, so a per-term line is simply not owed —
        which is why `build_draft` can return no lines without that being an
        error."""
        self.assertFalse(
            invoicing.schedule_applies_to_period(
                schedule=StubSchedule(
                    Decimal("3000.00"),
                    frequency=FeeFrequency.PER_TERM,
                    term_id=uuid.uuid4(),
                    due_day=None,
                ),
                period_start=SEP,
                period_end=SEP_END,
                term_id=None,
            )
        )


class DueDateTests(SimpleTestCase):
    def test_a_monthly_due_day_lands_in_the_billed_month(self) -> None:
        due = invoicing.due_date_for(
            schedule=StubSchedule(Decimal("100.00"), due_day=10),
            period_start=SEP,
            term_end=None,
        )

        self.assertEqual(due, datetime.date(2026, 9, 10))

    def test_a_due_day_past_the_month_s_length_is_clamped(self) -> None:
        """`due_day` is constrained to 1-28 so this cannot arise from the API.
        The clamp stays because a data migration or a future relaxation of that
        constraint should not raise a ValueError inside a billing job."""
        due = invoicing.due_date_for(
            schedule=StubSchedule(Decimal("100.00"), due_day=31),
            period_start=datetime.date(2027, 2, 1),
            term_end=None,
        )

        self.assertEqual(due, datetime.date(2027, 2, 28))

    def test_a_per_term_charge_falls_due_at_the_term_s_end(self) -> None:
        due = invoicing.due_date_for(
            schedule=StubSchedule(
                Decimal("3000.00"), frequency=FeeFrequency.PER_TERM, due_day=None
            ),
            period_start=SEP,
            term_end=datetime.date(2026, 12, 20),
        )

        self.assertEqual(due, datetime.date(2026, 12, 20))


class ProrationTests(SimpleTestCase):
    def test_a_student_enrolled_before_the_period_pays_in_full(self) -> None:
        factor = invoicing.proration_factor(
            frequency=FeeFrequency.MONTHLY,
            period_start=SEP,
            period_end=SEP_END,
            enrolled_from=datetime.date(2026, 4, 1),
        )

        self.assertEqual(factor, Decimal("1"))

    def test_a_mid_month_joiner_pays_for_the_days_they_were_enrolled(self) -> None:
        """Inclusive of both ends: joining on the 16th of a 30-day month is 15
        days, not 14."""
        factor = invoicing.proration_factor(
            frequency=FeeFrequency.MONTHLY,
            period_start=SEP,
            period_end=SEP_END,
            enrolled_from=datetime.date(2026, 9, 16),
        )

        self.assertEqual(factor, Decimal(15) / Decimal(30))

    def test_a_joiner_on_the_last_day_still_owes_one_day(self) -> None:
        """A zero-value line is harder to explain to a parent than a small one."""
        factor = invoicing.proration_factor(
            frequency=FeeFrequency.MONTHLY,
            period_start=SEP,
            period_end=SEP_END,
            enrolled_from=SEP_END,
        )

        self.assertEqual(factor, Decimal(1) / Decimal(30))

    def test_a_student_enrolling_after_the_period_owes_nothing(self) -> None:
        factor = invoicing.proration_factor(
            frequency=FeeFrequency.MONTHLY,
            period_start=SEP,
            period_end=SEP_END,
            enrolled_from=datetime.date(2026, 10, 1),
        )

        self.assertEqual(factor, Decimal("0.00"))

    def test_a_one_time_charge_is_never_prorated(self) -> None:
        """An admission fee is not half-owed by a student who joined mid-month,
        and prorating it would be a discount nobody granted."""
        factor = invoicing.proration_factor(
            frequency=FeeFrequency.ONE_TIME,
            period_start=SEP,
            period_end=SEP_END,
            enrolled_from=datetime.date(2026, 9, 20),
        )

        self.assertEqual(factor, Decimal("1"))


class GrantApplicationTests(SimpleTestCase):
    def _lines(self, *amounts: str) -> list[invoicing.DraftLine]:
        return [
            invoicing.DraftLine(
                fee_head_id=TUITION,
                description="Tuition",
                amount=Decimal(amount),
                source_type="schedule",
            )
            for amount in amounts
        ]

    def test_a_percent_discount_reduces_by_that_share(self) -> None:
        lines = self._lines("1000.00")

        total = invoicing.apply_grants(
            lines=lines,
            discounts=[StubGrant(Decimal("10.00"))],
            scholarships=[],
            on_date=SEP,
        )

        self.assertEqual(total, Decimal("100.00"))
        self.assertEqual(lines[0].discount_amount, Decimal("100.00"))

    def test_a_fixed_discount_larger_than_the_line_is_clamped_to_it(self) -> None:
        """§11 — no line goes below zero. Without the clamp the school would
        appear to owe the parent money."""
        lines = self._lines("500.00")

        total = invoicing.apply_grants(
            lines=lines,
            discounts=[StubGrant(Decimal("900.00"), discount_type=GrantValueType.FIXED)],
            scholarships=[],
            on_date=SEP,
        )

        self.assertEqual(total, Decimal("500.00"))
        self.assertEqual(lines[0].discount_amount, Decimal("500.00"))

    def test_scholarships_apply_before_discounts(self) -> None:
        """The order is fixed in `apply_grants` and this is what pins it.

        A 50% scholarship and a fixed 600 discount on a 1000 line: scholarship
        first takes 500, then the discount is clamped to the remaining 500, so
        the line is fully covered and the total reduced is 1000. Applying the
        discount first would take 600, leaving 400 for the scholarship to cover
        — the sponsor pays less and the school absorbs more.
        """
        lines = self._lines("1000.00")

        total = invoicing.apply_grants(
            lines=lines,
            discounts=[StubGrant(Decimal("600.00"), discount_type=GrantValueType.FIXED)],
            scholarships=[StubGrant(Decimal("50.00"), coverage_type=GrantValueType.PERCENT)],
            on_date=SEP,
        )

        self.assertEqual(total, Decimal("1000.00"))
        self.assertEqual(lines[0].discount_amount, Decimal("1000.00"))

    def test_a_head_scoped_discount_leaves_other_heads_alone(self) -> None:
        lines = [
            invoicing.DraftLine(
                fee_head_id=TUITION,
                description="Tuition",
                amount=Decimal("1000.00"),
                source_type="schedule",
            ),
            invoicing.DraftLine(
                fee_head_id=TRANSPORT,
                description="Transport",
                amount=Decimal("500.00"),
                source_type="schedule",
            ),
        ]

        invoicing.apply_grants(
            lines=lines,
            discounts=[StubGrant(Decimal("10.00"), fee_head_id=TRANSPORT)],
            scholarships=[],
            on_date=SEP,
        )

        self.assertEqual(lines[0].discount_amount, Decimal("0.00"))
        self.assertEqual(lines[1].discount_amount, Decimal("50.00"))

    def test_a_discount_outside_its_validity_window_does_not_apply(self) -> None:
        """The dates are the truth, `status` is the convenience.

        `status` is moved by a sweep, and a school billing on the 1st should not
        depend on the sweep having run — so `discount_applies` checks the window
        rather than trusting the column.
        """
        lines = self._lines("1000.00")

        invoicing.apply_grants(
            lines=lines,
            discounts=[
                StubGrant(
                    Decimal("10.00"),
                    valid_from=datetime.date(2026, 10, 1),
                    valid_to=datetime.date(2026, 12, 31),
                )
            ],
            scholarships=[],
            on_date=SEP,
        )

        self.assertEqual(lines[0].discount_amount, Decimal("0.00"))

    def test_a_revoked_discount_does_not_apply(self) -> None:
        lines = self._lines("1000.00")

        invoicing.apply_grants(
            lines=lines,
            discounts=[StubGrant(Decimal("10.00"), status=DiscountStatus.REVOKED)],
            scholarships=[],
            on_date=SEP,
        )

        self.assertEqual(lines[0].discount_amount, Decimal("0.00"))

    def test_an_applied_scholarship_is_not_yet_a_reduction(self) -> None:
        """Billing on `applied` would hand a student a reduction the school
        never granted."""
        lines = self._lines("1000.00")

        invoicing.apply_grants(
            lines=lines,
            discounts=[],
            scholarships=[StubGrant(Decimal("50.00"), status=ScholarshipStatus.APPLIED)],
            on_date=SEP,
        )

        self.assertEqual(lines[0].discount_amount, Decimal("0.00"))


class BuildDraftTests(SimpleTestCase):
    def test_a_draft_totals_its_lines_and_derives_the_balance(self) -> None:
        draft = invoicing.build_draft(
            schedules=[StubSchedule(Decimal("1000.00"))],
            fines=[],
            discounts=[StubGrant(Decimal("10.00"))],
            scholarships=[],
            period_start=SEP,
            period_end=SEP_END,
            head_names={TUITION: "Tuition"},
        )

        self.assertEqual(draft.subtotal, Decimal("1000.00"))
        self.assertEqual(draft.discount_total, Decimal("100.00"))
        self.assertEqual(draft.balance_due, Decimal("900.00"))

    def test_a_fine_is_added_at_full_value_and_never_discounted(self) -> None:
        """A penalty reduced by a sibling discount would be a policy nobody
        wrote down."""
        draft = invoicing.build_draft(
            schedules=[StubSchedule(Decimal("1000.00"))],
            fines=[StubFine(Decimal("250.00"))],
            discounts=[StubGrant(Decimal("50.00"))],
            scholarships=[],
            period_start=SEP,
            period_end=SEP_END,
            head_names={TUITION: "Tuition"},
        )

        self.assertEqual(draft.fine_total, Decimal("250.00"))
        self.assertEqual(draft.discount_total, Decimal("500.00"))
        self.assertEqual(draft.balance_due, Decimal("750.00"))
        fine_line = next(line for line in draft.lines if line.source_type == "fine")
        self.assertEqual(fine_line.discount_amount, Decimal("0.00"))

    def test_a_prorated_line_says_so_in_its_description(self) -> None:
        """A parent comparing two months' invoices needs to see why one is
        smaller, without ringing the office."""
        draft = invoicing.build_draft(
            schedules=[StubSchedule(Decimal("1000.00"))],
            fines=[],
            discounts=[],
            scholarships=[],
            period_start=SEP,
            period_end=SEP_END,
            enrolled_from=datetime.date(2026, 9, 16),
            head_names={TUITION: "Tuition"},
        )

        self.assertEqual(draft.lines[0].amount, Decimal("500.00"))
        self.assertIn("prorated", draft.lines[0].description)

    def test_a_draft_with_nothing_owed_has_no_lines(self) -> None:
        """Not an error: a per-term-only structure billed in a month with no
        term simply owes nothing, and raising a zero invoice would put an empty
        statement in front of a parent."""
        draft = invoicing.build_draft(
            schedules=[
                StubSchedule(
                    Decimal("3000.00"),
                    frequency=FeeFrequency.PER_TERM,
                    term_id=uuid.uuid4(),
                    due_day=None,
                )
            ],
            fines=[],
            discounts=[],
            scholarships=[],
            period_start=SEP,
            period_end=SEP_END,
            term_id=None,
        )

        self.assertEqual(draft.lines, [])

    def test_the_due_date_is_the_earliest_across_the_period_s_charges(self) -> None:
        """Anything later would let part of the invoice go quietly overdue
        outside the aging report."""
        draft = invoicing.build_draft(
            schedules=[
                StubSchedule(Decimal("1000.00"), due_day=20),
                StubSchedule(Decimal("500.00"), due_day=5, fee_head_id=TRANSPORT),
            ],
            fines=[],
            discounts=[],
            scholarships=[],
            period_start=SEP,
            period_end=SEP_END,
            head_names={TUITION: "Tuition", TRANSPORT: "Transport"},
        )

        self.assertEqual(draft.due_date, datetime.date(2026, 9, 5))


class PeriodLabelTests(SimpleTestCase):
    def test_a_monthly_label_is_the_year_and_month(self) -> None:
        """Derived, never typed: the label is half the duplicate guard, and a
        hand-entered "Sept 2026" beside a generated "2026-09" would let the same
        month be billed twice."""
        self.assertEqual(
            invoicing.period_label(
                frequency=FeeFrequency.MONTHLY, period_start=SEP, term_name=None
            ),
            "2026-09",
        )

    def test_a_per_term_label_is_the_term_s_name(self) -> None:
        self.assertEqual(
            invoicing.period_label(
                frequency=FeeFrequency.PER_TERM, period_start=SEP, term_name="Term 1"
            ),
            "Term 1",
        )
