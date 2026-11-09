"""Test support for `non_atomic_requests` routes: DRF's rollback as production sees it.

On an error response DRF's `set_rollback` marks the innermost open atomic block for
rollback. On a `non_atomic_requests` route in production there is none, so it does
nothing. Under `TestCase` it finds the test's own wrapping transaction and marks
*that*, so every later query in the test fails with `TransactionManagementError`.
This patch skips the blocks `TestCase` opened, the way Django itself does for
`atomic(durable=True)` (`Atomic._from_testcase`).

`feat/fee-online-payments` carries the same patch in `OnlinePaymentsTestCase`
(lesson L62); whichever branch merges second consolidates on this one
(`docs/deferred-work.md`).
"""

from __future__ import annotations

from unittest import mock

from django.db import connections
from django.test import SimpleTestCase


def _set_rollback_as_in_production() -> None:
    for db in connections.all(initialized_only=True):
        if db.settings_dict["ATOMIC_REQUESTS"] and any(
            not block._from_testcase for block in db.atomic_blocks
        ):
            db.set_rollback(True)


def rollback_as_in_production(test: SimpleTestCase) -> None:
    """Call from `setUp` of a test that drives a `non_atomic_requests` route to an error."""
    patcher = mock.patch("rest_framework.views.set_rollback", _set_rollback_as_in_production)
    patcher.start()
    test.addCleanup(patcher.stop)
