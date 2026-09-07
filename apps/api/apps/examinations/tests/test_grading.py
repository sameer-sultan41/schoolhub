"""The grading maths — §11's band rules and §5.5's percentage-to-grade lookup.

`assert_scale_is_complete` gets the most cases here, and deliberately: it is the
one rule in this module that the database cannot hold, so these tests are the
only thing standing between a school and a result nothing grades.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from django.test import SimpleTestCase

from apps.examinations import grading
from apps.examinations.models import ScaleType
from core.api.exceptions import DomainRuleViolation


@dataclass
class Band:
    """A stand-in for `GradeBand`, so these cases need no database.

    `grading` takes rows and never queries — that is the property being relied
    on here, and a fake with the same three attributes is enough to prove the
    functions honour it.
    """

    label: str
    min_percent: Decimal
    max_percent: Decimal
    grade_point: Decimal | None = None
    is_passing: bool = True


@dataclass
class Scale:
    scale_type: str
    gpa_max: Decimal | None = None


def bands(*triples) -> list[Band]:
    return [
        Band(label=label, min_percent=Decimal(low), max_percent=Decimal(high))
        for label, low, high in triples
    ]


COMPLETE = bands(
    ("A", "80.00", "100.00"),
    ("B", "70.00", "79.99"),
    ("C", "60.00", "69.99"),
    ("D", "50.00", "59.99"),
    ("F", "0.00", "49.99"),
)


class PercentageTests(SimpleTestCase):
    def test_a_percentage_is_one_decimal_place(self) -> None:
        self.assertEqual(grading.percentage_for(Decimal("74"), Decimal("80")), Decimal("92.5"))

    def test_a_half_rounds_up_not_to_even(self) -> None:
        """84.55 becomes 84.6, which is what a school and a parent both expect.
        Python's default banker's rounding would give 84.5 here and 84.6 for an
        identically-shaped input one mark away, and a grade boundary decided
        that way is a conversation nobody wants."""
        self.assertEqual(grading.percentage_for(Decimal("169.1"), Decimal("200")), Decimal("84.6"))

    def test_a_zero_maximum_is_zero_not_a_division_error(self) -> None:
        """Every subject in the aggregate was exempt — a real state for a
        student on a reduced timetable. A zero the caller can interpret
        alongside `outcome` beats an exception mid-job."""
        self.assertEqual(grading.percentage_for(Decimal("0"), Decimal("0")), Decimal("0.0"))

    def test_a_perfect_result_is_a_hundred(self) -> None:
        self.assertEqual(grading.percentage_for(Decimal("100"), Decimal("100")), Decimal("100.0"))


class ScaleCompletenessTests(SimpleTestCase):
    def test_a_complete_scale_passes(self) -> None:
        grading.assert_scale_is_complete(COMPLETE)

    def test_an_empty_scale_is_refused(self) -> None:
        with self.assertRaises(DomainRuleViolation):
            grading.assert_scale_is_complete([])

    def test_a_scale_that_does_not_start_at_zero_is_refused(self) -> None:
        """A result below the lowest band would have no grade at all."""
        incomplete = bands(("A", "80.00", "100.00"), ("B", "40.00", "79.99"))

        with self.assertRaises(DomainRuleViolation) as caught:
            grading.assert_scale_is_complete(incomplete)

        self.assertIn("must start at 0", str(caught.exception.detail))

    def test_a_scale_that_does_not_reach_a_hundred_is_refused(self) -> None:
        incomplete = bands(("B", "50.00", "89.99"), ("F", "0.00", "49.99"))

        with self.assertRaises(DomainRuleViolation) as caught:
            grading.assert_scale_is_complete(incomplete)

        self.assertIn("must reach 100", str(caught.exception.detail))

    def test_overlapping_bands_are_refused_and_both_are_named(self) -> None:
        """An error saying only "bands are invalid" leaves an admin hunting a
        seam by eye across fifteen rows."""
        overlapping = bands(
            ("A", "75.00", "100.00"), ("B", "50.00", "79.99"), ("F", "0.00", "49.99")
        )

        with self.assertRaises(DomainRuleViolation) as caught:
            grading.assert_scale_is_complete(overlapping)

        message = str(caught.exception.detail)
        self.assertIn("overlap", message)
        self.assertIn("A", message)
        self.assertIn("B", message)

    def test_a_gap_wide_enough_to_swallow_a_real_result_is_refused(self) -> None:
        """0-49 then 50-100 leaves 49.5 ungraded, and `NUMERIC(5,2)` can store
        49.5 — so this is a gap a student can actually land in, not a
        theoretical one."""
        gapped = bands(("P", "50.00", "100.00"), ("F", "0.00", "49.00"))

        with self.assertRaises(DomainRuleViolation) as caught:
            grading.assert_scale_is_complete(gapped)

        self.assertIn("Nothing grades a result between", str(caught.exception.detail))

    def test_a_two_decimal_seam_is_contiguous(self) -> None:
        """The control for the case above: 49.99 -> 50.00 is the tightest seam
        the column can express, and it must be accepted."""
        grading.assert_scale_is_complete(bands(("P", "50.00", "100.00"), ("F", "0.00", "49.99")))

    def test_bands_need_not_be_supplied_in_order(self) -> None:
        """A scale is edited band by band, so the rows arrive in whatever order
        they were written. Sorting is this function's job, not the caller's."""
        grading.assert_scale_is_complete(list(reversed(COMPLETE)))

    def test_a_single_band_covering_everything_is_complete(self) -> None:
        """A pass/fail school with one band is unusual but not wrong."""
        grading.assert_scale_is_complete(bands(("Pass", "0.00", "100.00")))


class BandLookupTests(SimpleTestCase):
    def test_a_percentage_lands_in_its_band(self) -> None:
        self.assertEqual(grading.band_for(Decimal("72.5"), COMPLETE).label, "B")

    def test_a_boundary_percentage_takes_the_upper_band(self) -> None:
        """Both ends of a band are inclusive, so exactly 80.0 matches two. The
        student gets the better grade — the reading a school will defend to a
        parent — and it is decided here rather than by row order."""
        self.assertEqual(grading.band_for(Decimal("80.00"), COMPLETE).label, "A")

    def test_zero_lands_in_the_lowest_band(self) -> None:
        self.assertEqual(grading.band_for(Decimal("0.00"), COMPLETE).label, "F")

    def test_a_hundred_lands_in_the_highest_band(self) -> None:
        self.assertEqual(grading.band_for(Decimal("100.00"), COMPLETE).label, "A")

    def test_an_ungraded_percentage_returns_none_rather_than_raising(self) -> None:
        """A caller grading a whole school treats None as a row to report, not
        as an exception that abandons the job. `assert_scale_is_complete` is
        what makes it unreachable for a scale an exam may use."""
        self.assertIsNone(grading.band_for(Decimal("49.50"), bands(("P", "50.00", "100.00"))))


class GpaTests(SimpleTestCase):
    A_GRADE = Band(
        label="A",
        min_percent=Decimal("80.00"),
        max_percent=Decimal("100.00"),
        grade_point=Decimal("4.00"),
    )

    def test_a_gpa_scale_returns_the_band_s_grade_point(self) -> None:
        scale = Scale(scale_type=ScaleType.GPA, gpa_max=Decimal("4.00"))

        self.assertEqual(grading.gpa_for(self.A_GRADE, scale), Decimal("4.00"))

    def test_a_hybrid_scale_also_returns_it(self) -> None:
        scale = Scale(scale_type=ScaleType.HYBRID, gpa_max=Decimal("4.00"))

        self.assertEqual(grading.gpa_for(self.A_GRADE, scale), Decimal("4.00"))

    def test_a_letter_scale_returns_none_even_where_a_point_exists(self) -> None:
        """The scale type is what the school published. Emitting a GPA it never
        defined would put a number on a report card that nothing backs."""
        scale = Scale(scale_type=ScaleType.LETTER)

        self.assertIsNone(grading.gpa_for(self.A_GRADE, scale))

    def test_no_band_means_no_gpa(self) -> None:
        scale = Scale(scale_type=ScaleType.GPA, gpa_max=Decimal("4.00"))

        self.assertIsNone(grading.gpa_for(None, scale))
