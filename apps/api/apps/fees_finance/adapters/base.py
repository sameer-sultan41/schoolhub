"""The settlement-adapter interface and its registry.

An adapter's only job is to turn one provider's file into
`SettlementFileRow`s. It does no matching, no posting and no validation beyond
what it takes to read a row — everything downstream is provider-agnostic, which
is what makes "a new provider is a new adapter" true rather than aspirational.

**Adapters never raise on a bad row.** A single malformed line must not stop the
other four hundred posting; §7.2 puts unmatched and unreadable rows in an
exceptions queue an accountant works through. So `parse` yields rows and
collects problems, and the caller decides what to do with each.
"""

from __future__ import annotations

import datetime
from collections.abc import Iterator
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Protocol


@dataclass(frozen=True)
class SettlementFileRow:
    """One normalized settlement line.

    `transaction_reference` is the provider's own idempotency handle and is what
    §11's match key turns on — without it a re-imported file would post twice.
    """

    consumer_number: str
    transaction_reference: str
    amount: Decimal
    paid_on: datetime.date
    row_number: int


@dataclass
class ParseResult:
    """What an adapter made of a file: the rows it read and the ones it could not."""

    rows: list[SettlementFileRow] = field(default_factory=list)
    #: `{row, reason}` per unreadable line, in the shape
    #: `voucher_collection_imports.exceptions` stores.
    problems: list[dict] = field(default_factory=list)


class SettlementAdapter(Protocol):
    """What every provider adapter must offer."""

    provider: str

    def parse(self, data: bytes) -> ParseResult:
        """Normalize a settlement file. Never raises on a bad row."""
        ...


_ADAPTERS: dict[str, SettlementAdapter] = {}


def register_adapter(adapter: SettlementAdapter) -> SettlementAdapter:
    _ADAPTERS[adapter.provider] = adapter
    return adapter


def adapter_for(provider: str) -> SettlementAdapter:
    """The adapter for `provider`, or a loud failure.

    A provider with no adapter is a voucher nothing can ever reconcile, so this
    raises rather than returning None — the import endpoint turns it into a 422
    naming the provider, which is a far better answer than an empty file result.
    """
    try:
        return _ADAPTERS[provider]
    except KeyError:
        raise LookupError(
            f"No settlement adapter is registered for '{provider}'. "
            "Add one under apps/fees_finance/adapters/ and register it."
        ) from None


def registered_providers() -> Iterator[str]:
    return iter(sorted(_ADAPTERS))
