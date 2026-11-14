"""Test support for `non_atomic_requests` routes: DRF's rollback as production sees it.

On an error response DRF's `set_rollback` marks the innermost open atomic block for
rollback. On a `non_atomic_requests` route in production there is none, so it does
nothing. Under `TestCase` it finds the test's own wrapping transaction and marks
*that*, so every later query in the test fails with `TransactionManagementError`.
This patch skips the blocks `TestCase` opened, the way Django itself does for
`atomic(durable=True)` (`Atomic._from_testcase`).

`OnlinePaymentsTestCase` (`apps/fees_finance/tests/online_base.py`) and the AI
report-summary tests both use it (lesson L62).
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from unittest import mock

from django.db import connections
from django.test import SimpleTestCase

_TARGET = "rest_framework.views.set_rollback"


def _set_rollback_as_in_production() -> None:
    for db in connections.all(initialized_only=True):
        if db.settings_dict["ATOMIC_REQUESTS"] and any(
            not block._from_testcase for block in db.atomic_blocks
        ):
            db.set_rollback(True)


@contextmanager
def production_rollback() -> Iterator[None]:
    """The same patch for one `with` block, around a direct call into DRF's exception handler."""
    with mock.patch(_TARGET, _set_rollback_as_in_production):
        yield


def rollback_as_in_production(test: SimpleTestCase) -> None:
    """Call from `setUp` of a test that drives a `non_atomic_requests` route to an error."""
    patcher = mock.patch(_TARGET, _set_rollback_as_in_production)
    patcher.start()
    test.addCleanup(patcher.stop)
