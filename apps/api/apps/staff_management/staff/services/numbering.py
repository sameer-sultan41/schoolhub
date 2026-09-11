"""Employee-number generation: pattern validation, rendering, and allocation.

Mirrors student_management's admission-number pattern exactly — same
allowlist-substitution reasoning (never ``str.format(**ctx)``, an injection
surface for a tenant-controlled string) and the same series-key rule: two
employee numbers differing only in sequence width must share one counter.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Callable
from datetime import date

from django.db import transaction

from apps.staff_management.services import _tenant_settings
from core.api.exceptions import DomainRuleViolation
from core.tenancy.sequences import allocate_number

# Pattern tokens the employee-number template may use — same allowlist shape as
# student_management's admission-number pattern.
_PATTERN_TOKEN = re.compile(r"\{(campus|year)\}|\{seq(?::0(\d+)d)?\}")
_ANY_BRACE_TOKEN = re.compile(r"\{[^}]*\}")

_DEFAULT_PATTERN = "EMP-{year}-{seq:04d}"


def assert_pattern_tokens_valid(pattern: str) -> None:
    """Reject a pattern containing a `{...}` block that isn't a known token.

    Mirrors student_management.services.assert_pattern_tokens_valid exactly —
    same allowlist-substitution reasoning (never ``str.format(**ctx)``, an
    injection surface for a tenant-controlled string).
    """
    for token in _ANY_BRACE_TOKEN.findall(pattern):
        if not _PATTERN_TOKEN.fullmatch(token):
            raise DomainRuleViolation(
                {
                    "employee_number_pattern": (
                        f"'{token}' is not a recognized token. Use {{campus}}, {{year}}, "
                        "{seq}, or {seq:0Nd}."
                    )
                }
            )


def _substitute_tokens(
    pattern: str, *, campus: str, year: str, seq: Callable[[str | None], str]
) -> str:
    def _sub(match: re.Match) -> str:
        name, width = match.group(1), match.group(2)
        if name == "campus":
            return campus
        if name == "year":
            return year
        return seq(width)

    return _PATTERN_TOKEN.sub(_sub, pattern)


def _render_pattern(pattern: str, *, campus_code: str, year: str, sequence: int) -> str:
    return _substitute_tokens(
        pattern,
        campus=campus_code,
        year=year,
        seq=lambda width: str(sequence).zfill(int(width)) if width else str(sequence),
    )


def employee_number_series(*, pattern: str, campus_code: str, joining_date: date) -> str:
    """The counter's series key — see admission_number_series's identical

    reasoning: two employee numbers sharing everything except the sequence
    must share one counter.
    """
    return _substitute_tokens(
        pattern, campus=campus_code, year=str(joining_date.year), seq=lambda width: ""
    )


def render_employee_number(
    *, pattern: str, campus_code: str, joining_date: date, sequence: int
) -> str:
    return _render_pattern(
        pattern, campus_code=campus_code, year=str(joining_date.year), sequence=sequence
    )


@transaction.atomic
def allocate_employee_number(*, campus, joining_date: date, tenant_id: uuid.UUID) -> str:
    """Generate and reserve the next employee number for ``campus``/``joining_date``.

    Must run inside the same transaction as the Staff insert — allocate_number
    asserts this — so a create that fails afterward does not burn the number.
    """
    tenant_settings = _tenant_settings(tenant_id)
    pattern = (tenant_settings.get("employee_number_pattern") or _DEFAULT_PATTERN).strip()
    if not pattern:
        pattern = _DEFAULT_PATTERN
    assert_pattern_tokens_valid(pattern)

    series = employee_number_series(
        pattern=pattern, campus_code=campus.code, joining_date=joining_date
    )
    sequence = allocate_number(scope="employee_number", series=series, tenant_id=tenant_id)
    return render_employee_number(
        pattern=pattern, campus_code=campus.code, joining_date=joining_date, sequence=sequence
    )
