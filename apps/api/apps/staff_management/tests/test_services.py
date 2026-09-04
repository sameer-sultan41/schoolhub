"""Unit tests for pure, DB-free helpers in services.py.

Mirrors student_management/tests/test_services.py's DB-free pattern. The
``reports_to`` cycle walk is exercised without a database too: assigning a
ForeignKey directly on an unsaved instance caches it, so ``current.reports_to``
below never issues a query.
"""

from __future__ import annotations

import uuid
from datetime import date

from django.test import SimpleTestCase
from rest_framework.exceptions import APIException

from apps.staff_management import services
from apps.staff_management.models import Staff


def _unsaved_staff() -> Staff:
    return Staff(pk=uuid.uuid4())


class AssertPatternTokensValidTests(SimpleTestCase):
    def test_the_three_known_token_shapes_are_accepted(self) -> None:
        services.assert_pattern_tokens_valid("{campus}-{year}-{seq}")
        services.assert_pattern_tokens_valid("{campus}{year}-{seq:04d}")

    def test_a_pattern_with_no_tokens_at_all_is_accepted(self) -> None:
        services.assert_pattern_tokens_valid("STATIC-PREFIX")

    def test_a_seq_format_missing_the_leading_zero_is_rejected(self) -> None:
        with self.assertRaises(APIException) as ctx:
            services.assert_pattern_tokens_valid("{campus}-{seq:2d}")
        self.assertIn("seq:2d", str(ctx.exception.detail))

    def test_an_unknown_token_name_is_rejected(self) -> None:
        with self.assertRaises(APIException):
            services.assert_pattern_tokens_valid("{campus}-{typo}")


class TokenSubstitutionTests(SimpleTestCase):
    def test_render_employee_number_substitutes_every_token(self) -> None:
        rendered = services.render_employee_number(
            pattern="{campus}-{year}-{seq:04d}",
            campus_code="MAIN",
            joining_date=date(2026, 4, 1),
            sequence=7,
        )
        self.assertEqual(rendered, "MAIN-2026-0007")

    def test_employee_number_series_blanks_the_sequence_token_only(self) -> None:
        series = services.employee_number_series(
            pattern="{campus}-{year}-{seq:04d}", campus_code="MAIN", joining_date=date(2026, 4, 1)
        )
        self.assertEqual(series, "MAIN-2026-")

    def test_two_patterns_differing_only_in_sequence_width_share_one_series(self) -> None:
        """employee_number_series and render_employee_number both dispatch through
        the same _substitute_tokens helper — this pins that the series key it
        produces is unaffected by an unrelated change in zero-padding width."""
        narrow = services.employee_number_series(
            pattern="{campus}-{seq:02d}", campus_code="MAIN", joining_date=date(2026, 4, 1)
        )
        wide = services.employee_number_series(
            pattern="{campus}-{seq:04d}", campus_code="MAIN", joining_date=date(2026, 4, 1)
        )
        self.assertEqual(narrow, wide)


class AssertReportsToAcyclicTests(SimpleTestCase):
    def test_a_staff_member_cannot_report_to_themself(self) -> None:
        staff = _unsaved_staff()
        with self.assertRaises(APIException) as ctx:
            services.assert_reports_to_acyclic(staff=staff, reports_to=staff)
        self.assertIn("reports_to_staff_id", ctx.exception.detail)

    def test_a_brand_new_staff_member_has_no_pk_to_cycle_back_to(self) -> None:
        """create_staff calls this with staff=None — nothing to compare against yet,
        so it returns without walking the chain at all."""
        manager = _unsaved_staff()
        services.assert_reports_to_acyclic(staff=None, reports_to=manager)

    def test_a_valid_non_cyclic_chain_is_accepted(self) -> None:
        staff = _unsaved_staff()
        grandparent = _unsaved_staff()
        parent = _unsaved_staff()
        parent.reports_to = grandparent

        services.assert_reports_to_acyclic(staff=staff, reports_to=parent)

    def test_a_cycle_three_levels_deep_is_rejected(self) -> None:
        staff = _unsaved_staff()
        first = _unsaved_staff()
        second = _unsaved_staff()
        third = _unsaved_staff()
        first.reports_to = second
        second.reports_to = third
        third.reports_to = first  # closes the cycle; none of these is `staff` itself

        with self.assertRaises(APIException) as ctx:
            services.assert_reports_to_acyclic(staff=staff, reports_to=first)
        self.assertIn("reports_to_staff_id", ctx.exception.detail)
