"""Gapless document numbers for invoices and receipts.

Every number here goes through `core.tenancy.sequences.allocate_number`, whose
own module docstring already names this module as a future caller: a counter row
taken `FOR UPDATE` in the same transaction as the document it numbers. It
refuses to run outside a transaction, and that assertion *is* the gapless
guarantee — a rolled-back allocation was never issued, so nothing is skipped.

The pattern mechanics mirror `student_management.services`' admission numbers,
including the one non-obvious part: the counter's *series* key is the pattern
with the sequence token **blanked**, not rendered as zero. Two numbers differing
only in sequence must share a counter; two whose year or prefix differ must not.
Baking a literal `0000` into the series would make a stray zero elsewhere in the
rendered string collide two series that should be separate.

Patterns live in `TenantSettings.finance`, a namespace this module introduces
beside the existing `academic` and `hr` ones — the same reasoning `hr` records:
a module's configuration gets its own key rather than crowding another's.
"""

from __future__ import annotations

import datetime
import re
import uuid

from django.db import transaction

from core.api.exceptions import DomainRuleViolation
from core.tenancy.sequences import allocate_number

DEFAULT_INVOICE_PATTERN = "INV-{year}-{seq:05d}"
DEFAULT_RECEIPT_PATTERN = "RCP-{year}-{seq:05d}"

_TOKEN = re.compile(r"\{(year|seq)(?::0(\d+)d)?\}")
_ALLOWED_TOKENS = {"year", "seq"}


def assert_pattern_is_valid(pattern: str, *, field: str) -> None:
    """A pattern without `{seq}` numbers every document identically.

    Checked when the pattern is read rather than when the collision happens: the
    unique index would refuse the second document, but at that point a school is
    mid-billing-run and the error names an index rather than the setting that
    caused it.
    """
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
        # `name`, not `token`: ruff's S105 reads `token == "..."` as a
        # hardcoded credential comparison. The variable is a regex group name.
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


def _pattern(*, tenant_id: uuid.UUID, key: str, default: str, field: str) -> str:
    from core.tenancy.models import TenantSettings

    settings = TenantSettings.objects.filter(tenant_id=tenant_id).first()
    finance = (settings.finance if settings else None) or {}
    pattern = (finance.get(key) or default).strip() or default
    assert_pattern_is_valid(pattern, field=field)
    return pattern


def _allocate(*, tenant_id: uuid.UUID, scope: str, pattern: str, on_date: datetime.date) -> str:
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError(
            f"allocate_{scope}() must run inside the same transaction as the row it "
            "numbers, or a rolled-back document burns a number. Wrap the caller in "
            "transaction.atomic()."
        )
    year = str(on_date.year)
    sequence = allocate_number(
        scope=scope, series=series_for(pattern, year=year), tenant_id=tenant_id
    )
    return _substitute(pattern, year=year, sequence=sequence)


def allocate_invoice_no(*, tenant_id: uuid.UUID, issue_date: datetime.date) -> str:
    return _allocate(
        tenant_id=tenant_id,
        scope="invoice_number",
        pattern=_pattern(
            tenant_id=tenant_id,
            key="invoice_number_pattern",
            default=DEFAULT_INVOICE_PATTERN,
            field="invoice_number_pattern",
        ),
        on_date=issue_date,
    )


def allocate_receipt_no(*, tenant_id: uuid.UUID, issued_on: datetime.date) -> str:
    """Used by PR C. Defined here so both numbers share one implementation."""
    return _allocate(
        tenant_id=tenant_id,
        scope="receipt_number",
        pattern=_pattern(
            tenant_id=tenant_id,
            key="receipt_number_pattern",
            default=DEFAULT_RECEIPT_PATTERN,
            field="receipt_number_pattern",
        ),
        on_date=issued_on,
    )
