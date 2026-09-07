"""Money arithmetic for the finance module and anything else that holds an amount.

Every monetary column on the platform is ``numeric(12,2)`` in the tenant's
configured currency (``Tenant.currency``); there is no per-row currency column
and multi-currency is out of scope — see docs/03-modules/fees-finance.md §1 and
docs/02-architecture/database-architecture.md.

Pure functions over ``Decimal``, no queries and no model imports, so a posting
engine can validate a whole batch in memory. The style follows
``apps/examinations/grading.py``: constants at the top, the rounding mode stated
rather than inherited, and the reason for it written down.
"""

from __future__ import annotations

from collections.abc import Sequence
from decimal import ROUND_HALF_UP, Decimal
from typing import Protocol

ZERO = Decimal("0.00")

#: Two decimal places, matching the `numeric(12,2)` columns exactly. Quantizing
#: to anything else and letting the database round is how a total stops matching
#: the sum of its lines.
MONEY_PRECISION = Decimal("0.01")

#: `numeric(12,2)` holds ten integer digits. Asserted rather than assumed,
#: because a value that overflows is a `DataError` from PostgreSQL in the middle
#: of a batch rather than a 422 on the request that caused it.
MONEY_MAX = Decimal("9999999999.99")


def quantize_money(value: Decimal) -> Decimal:
    """Round to two decimal places, half away from zero.

    ROUND_HALF_UP, not Python's default ROUND_HALF_EVEN. Banker's rounding is
    the better choice when errors must cancel across a large sample, but a
    school reconciling one receipt against one bank statement expects the
    arithmetic a person would do by hand: 0.125 becomes 0.13, every time. The
    same reasoning is written out in ``apps/examinations/grading.py``.
    """
    return value.quantize(MONEY_PRECISION, rounding=ROUND_HALF_UP)


class _Posting(Protocol):
    """The shape ``assert_balanced`` needs: anything with a debit and a credit.

    Read-only properties rather than attributes, so a frozen dataclass
    satisfies it. A mutable attribute in a Protocol is invariant and requires a
    settable attribute on the implementer, which would exclude exactly the
    immutable line type a posting engine should be passing around.
    """

    @property
    def debit(self) -> Decimal: ...

    @property
    def credit(self) -> Decimal: ...


def assert_balanced(lines: Sequence[_Posting]) -> tuple[Decimal, Decimal]:
    """Return ``(total_debit, total_credit)``, raising if they differ.

    Double-entry's whole guarantee. It cannot be a CHECK constraint: the rule is
    about the *set* of lines sharing a ``transaction_id``, and a constraint
    cannot see sibling rows — the same set-level shape examinations' grade-band
    contiguity rule has, resolved the same way.

    The error names both sums. "Unbalanced posting" alone is useless in a job log
    at 2am; the two figures and their difference are what identify the line that
    is wrong.
    """
    from core.api.exceptions import DomainRuleViolation

    if not lines:
        raise DomainRuleViolation("A ledger transaction must have at least one line.")

    total_debit = quantize_money(sum((line.debit for line in lines), ZERO))
    total_credit = quantize_money(sum((line.credit for line in lines), ZERO))

    if total_debit != total_credit:
        raise DomainRuleViolation(
            f"This posting does not balance: debits total {total_debit} and "
            f"credits total {total_credit}, a difference of "
            f"{abs(total_debit - total_credit)}.",
            meta={
                "total_debit": str(total_debit),
                "total_credit": str(total_credit),
                "difference": str(abs(total_debit - total_credit)),
            },
        )
    if total_debit == ZERO:
        raise DomainRuleViolation("A ledger transaction of zero moves nothing.")

    return total_debit, total_credit
