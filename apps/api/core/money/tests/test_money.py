"""Money arithmetic — the rounding decision and the balance rule.

Both are the kind of thing that looks obviously right and is obviously wrong six
months later, so each case names the school-facing consequence rather than the
arithmetic identity.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from django.test import SimpleTestCase

from core.api.exceptions import DomainRuleViolation
from core.money import MONEY_MAX, ZERO, assert_balanced, quantize_money


@dataclass
class Line:
    """The minimum `assert_balanced` needs — it is structural about its input."""

    debit: Decimal = ZERO
    credit: Decimal = ZERO


class QuantizeMoneyTests(SimpleTestCase):
    def test_a_half_cent_rounds_away_from_zero(self) -> None:
        """ROUND_HALF_UP, not Python's default banker's rounding.

        A school reconciling one receipt against one bank statement expects the
        arithmetic a person would do by hand. Under ROUND_HALF_EVEN this would
        be 0.12, and the receipt would disagree with the parent's own sum.
        """
        self.assertEqual(quantize_money(Decimal("0.125")), Decimal("0.13"))
        self.assertEqual(quantize_money(Decimal("0.135")), Decimal("0.14"))

    def test_it_does_not_round_bankers_style_on_the_even_case(self) -> None:
        """The case that distinguishes the two modes. Under ROUND_HALF_EVEN
        2.5 -> 2, which is the behaviour this module exists to avoid."""
        self.assertEqual(quantize_money(Decimal("2.005")), Decimal("2.01"))

    def test_a_negative_amount_rounds_away_from_zero_too(self) -> None:
        """Symmetry matters for a refund: rounding a credit differently from the
        debit it reverses is how a reversal fails to net to nothing."""
        self.assertEqual(quantize_money(Decimal("-0.125")), Decimal("-0.13"))

    def test_a_value_already_at_two_places_is_unchanged(self) -> None:
        self.assertEqual(quantize_money(Decimal("1500.00")), Decimal("1500.00"))

    def test_the_documented_maximum_fits_the_column(self) -> None:
        """`numeric(12,2)` holds ten integer digits. Asserted so the constant
        cannot drift from the column it describes."""
        self.assertEqual(MONEY_MAX, Decimal("9999999999.99"))
        self.assertEqual(quantize_money(MONEY_MAX), MONEY_MAX)


class AssertBalancedTests(SimpleTestCase):
    def test_a_balanced_pair_returns_both_totals(self) -> None:
        totals = assert_balanced([Line(debit=Decimal("100.00")), Line(credit=Decimal("100.00"))])

        self.assertEqual(totals, (Decimal("100.00"), Decimal("100.00")))

    def test_a_many_line_posting_balances_on_the_sums_not_pairwise(self) -> None:
        """One debit against three credits is an ordinary posting — a fee split
        across heads. Requiring pairs would refuse the normal case."""
        totals = assert_balanced(
            [
                Line(debit=Decimal("300.00")),
                Line(credit=Decimal("100.00")),
                Line(credit=Decimal("150.00")),
                Line(credit=Decimal("50.00")),
            ]
        )

        self.assertEqual(totals, (Decimal("300.00"), Decimal("300.00")))

    def test_an_unbalanced_posting_names_both_sums_and_the_difference(self) -> None:
        """ "Unbalanced posting" alone is useless in a job log at 2am; the two
        figures are what identify the line that is wrong."""
        with self.assertRaises(DomainRuleViolation) as caught:
            assert_balanced([Line(debit=Decimal("100.00")), Line(credit=Decimal("90.00"))])

        self.assertEqual(caught.exception.meta["total_debit"], "100.00")
        self.assertEqual(caught.exception.meta["total_credit"], "90.00")
        self.assertEqual(caught.exception.meta["difference"], "10.00")

    def test_a_posting_of_zero_is_refused(self) -> None:
        """It balances and moves nothing, which is a caller bug rather than a
        no-op worth committing to an immutable table."""
        with self.assertRaises(DomainRuleViolation):
            assert_balanced([Line(debit=ZERO), Line(credit=ZERO)])

    def test_an_empty_posting_is_refused(self) -> None:
        with self.assertRaises(DomainRuleViolation):
            assert_balanced([])

    def test_sub_cent_inputs_are_compared_after_quantizing(self) -> None:
        """Two values that differ below the cent are the same amount once stored.

        Comparing before quantizing would refuse a posting the database would
        then hold quite happily — a 422 on arithmetic that is actually correct.
        """
        totals = assert_balanced([Line(debit=Decimal("10.001")), Line(credit=Decimal("10.004"))])

        self.assertEqual(totals, (Decimal("10.00"), Decimal("10.00")))
