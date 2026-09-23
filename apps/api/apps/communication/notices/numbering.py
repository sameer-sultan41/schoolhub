"""Gapless notice numbers.

Mirrors `apps.fees_finance.numbering` exactly, including the one non-obvious
part: the counter's *series* key is the pattern with the sequence token
**blanked**, not rendered as zero — two numbers differing only in sequence
must share a counter, and baking a literal `0000` into the series would make a
stray zero elsewhere in the rendered string collide two series that should be
separate. See that module's own docstring for the full reasoning; it is not
repeated here since both modules must stay identical or the invariant drifts.

The pattern lives in `TenantSettings.communication`, this module's own
namespace beside `hr`/`finance`.
"""

from __future__ import annotations

import datetime
import re
import uuid

from django.db import transaction

from core.api.exceptions import DomainRuleViolation
from core.tenancy.sequences import allocate_number

DEFAULT_NOTICE_PATTERN = "NOT-{year}-{seq:05d}"

_TOKEN = re.compile(r"\{(year|seq)(?::0(\d+)d)?\}")
_ALLOWED_TOKENS = {"year", "seq"}


def assert_pattern_is_valid(pattern: str, *, field: str) -> None:
    found = {match.group(1) for match in _TOKEN.finditer(pattern)}
    unknown = set(re.findall(r"\{(\w+)", pattern)) - _ALLOWED_TOKENS
    if unknown:
        raise DomainRuleViolation(
            {field: f"Unknown pattern token(s): {', '.join(sorted(unknown))}."}
        )
    if "seq" not in found:
        raise DomainRuleViolation(
            {field: "A numbering pattern must contain {seq}, or every document gets one number."}
        )


def _substitute(pattern: str, *, year: str, sequence: int | None) -> str:
    def replace(match: re.Match) -> str:
        name, width = match.group(1), match.group(2)
        if name == "year":
            return year
        if sequence is None:
            return ""
        return str(sequence).zfill(int(width)) if width else str(sequence)

    return _TOKEN.sub(replace, pattern)


def series_for(pattern: str, *, year: str) -> str:
    """The counter key: the pattern rendered with the sequence token blanked."""
    return _substitute(pattern, year=year, sequence=None)


def _pattern(*, tenant_id: uuid.UUID) -> str:
    from core.tenancy.models import TenantSettings

    settings = TenantSettings.objects.filter(tenant_id=tenant_id).first()
    communication = (settings.communication if settings else None) or {}
    pattern = (communication.get("notice_number_pattern") or DEFAULT_NOTICE_PATTERN).strip()
    pattern = pattern or DEFAULT_NOTICE_PATTERN
    assert_pattern_is_valid(pattern, field="notice_number_pattern")
    return pattern


def allocate_notice_no(*, tenant_id: uuid.UUID, on_date: datetime.date) -> str:
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError(
            "allocate_notice_no() must run inside the same transaction as the row it "
            "numbers, or a rolled-back notice burns a number. Wrap the caller in "
            "transaction.atomic()."
        )
    pattern = _pattern(tenant_id=tenant_id)
    year = str(on_date.year)
    sequence = allocate_number(
        scope="notice_number", series=series_for(pattern, year=year), tenant_id=tenant_id
    )
    return _substitute(pattern, year=year, sequence=sequence)
