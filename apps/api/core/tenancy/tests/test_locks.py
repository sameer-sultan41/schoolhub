"""Tests for the shared advisory-lock helper (core/tenancy/locks.py)."""

from __future__ import annotations

import uuid

from django.db import connection
from django.test import SimpleTestCase, TestCase
from django.test.utils import CaptureQueriesContext

from core.tenancy.locks import AdvisoryLockNamespace, advisory_lock_key, advisory_xact_lock


class AdvisoryLockKeyTests(SimpleTestCase):
    def test_the_key_is_stable_and_fits_a_non_negative_int4(self) -> None:
        key = uuid.UUID("0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0")

        self.assertEqual(advisory_lock_key(key), advisory_lock_key(uuid.UUID(str(key))))
        self.assertGreaterEqual(advisory_lock_key(key), 0)
        self.assertLessEqual(advisory_lock_key(key), 2**31 - 1)

    def test_outside_a_transaction_it_refuses_rather_than_lock_nothing(self) -> None:
        with self.assertRaises(RuntimeError):
            advisory_xact_lock(AdvisoryLockNamespace.EXAM_SCHEDULE, uuid.uuid4())


class AdvisoryXactLockTests(TestCase):
    def test_it_takes_the_two_int_transaction_lock(self) -> None:
        key = uuid.uuid4()

        with CaptureQueriesContext(connection) as captured:
            advisory_xact_lock(AdvisoryLockNamespace.EXAM_SCHEDULE, key)

        namespace = int(AdvisoryLockNamespace.EXAM_SCHEDULE)
        self.assertIn(
            f"pg_advisory_xact_lock({namespace}, {advisory_lock_key(key)})",
            captured.captured_queries[-1]["sql"],
        )
