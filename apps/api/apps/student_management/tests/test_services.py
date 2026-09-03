"""Unit tests for pure admission-number pattern helpers in services.py.

No DB access needed — these are string-in/string-out functions kept separate
from create_student's DB-touching duplicate/allocation rules, which are
exercised end-to-end via test_api.py instead.
"""

from __future__ import annotations

from datetime import date

from django.test import SimpleTestCase
from rest_framework.exceptions import APIException

from apps.student_management import services


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
    def test_render_admission_number_substitutes_every_token(self) -> None:
        rendered = services.render_admission_number(
            pattern="{campus}-{year}-{seq:04d}",
            campus_code="MAIN",
            admission_date=date(2026, 4, 1),
            sequence=7,
        )
        self.assertEqual(rendered, "MAIN-2026-0007")

    def test_admission_number_series_blanks_the_sequence_token_only(self) -> None:
        series = services.admission_number_series(
            pattern="{campus}-{year}-{seq:04d}",
            campus_code="MAIN",
            admission_date=date(2026, 4, 1),
        )
        self.assertEqual(series, "MAIN-2026-")

    def test_two_patterns_differing_only_in_sequence_width_share_one_series(self) -> None:
        """admission_number_series and render_admission_number both dispatch through
        the same _substitute_tokens helper now — this pins that the series key
        it produces is unaffected by an unrelated change in zero-padding width."""
        narrow = services.admission_number_series(
            pattern="{campus}-{seq:02d}", campus_code="MAIN", admission_date=date(2026, 4, 1)
        )
        wide = services.admission_number_series(
            pattern="{campus}-{seq:04d}", campus_code="MAIN", admission_date=date(2026, 4, 1)
        )
        self.assertEqual(narrow, wide)


class DuplicateCheckLockKeyTests(SimpleTestCase):
    def test_the_same_inputs_always_produce_the_same_key(self) -> None:
        kwargs = {
            "tenant_id": "11111111-1111-1111-1111-111111111111",
            "first_name": "Amina",
            "last_name": "Khan",
            "date_of_birth": date(2015, 6, 1),
        }
        self.assertEqual(
            services._duplicate_check_lock_key(**kwargs),
            services._duplicate_check_lock_key(**kwargs),
        )

    def test_a_different_tenant_produces_a_different_key(self) -> None:
        base = {
            "first_name": "Amina",
            "last_name": "Khan",
            "date_of_birth": date(2015, 6, 1),
        }
        key_a = services._duplicate_check_lock_key(
            tenant_id="11111111-1111-1111-1111-111111111111", **base
        )
        key_b = services._duplicate_check_lock_key(
            tenant_id="22222222-2222-2222-2222-222222222222", **base
        )
        self.assertNotEqual(key_a, key_b)

    def test_the_key_fits_postgres_signed_bigint_range(self) -> None:
        key = services._duplicate_check_lock_key(
            tenant_id="11111111-1111-1111-1111-111111111111",
            first_name="Amina",
            last_name="Khan",
            date_of_birth=date(2015, 6, 1),
        )
        self.assertGreaterEqual(key, -(2**63))
        self.assertLess(key, 2**63)
