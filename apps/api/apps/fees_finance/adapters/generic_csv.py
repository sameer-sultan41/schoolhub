"""A provider-agnostic CSV settlement adapter.

The one adapter that ships. §19 leaves the real per-provider layouts
unconfirmed until those agreements are signed, so committing to a guessed
Easypaisa or JazzCash format would be inventing a contract — this reads a
documented neutral shape instead, and proves the matcher, the match key and the
exceptions queue that every real adapter will feed.

Expected header, case-insensitive, order-independent::

    consumer_number,transaction_reference,amount,paid_on

`paid_on` is ISO `YYYY-MM-DD`. Anything else about a row — extra columns, a
provider's own status flags — is ignored rather than rejected, because a
provider adding a column to their export must not break a school's collections
overnight.
"""

from __future__ import annotations

import csv
import datetime
import io
from decimal import Decimal, InvalidOperation

from apps.fees_finance.adapters.base import ParseResult, SettlementFileRow, register_adapter
from apps.fees_finance.models import VoucherProvider

REQUIRED_COLUMNS = ("consumer_number", "transaction_reference", "amount", "paid_on")


class GenericCsvAdapter:
    """Reads the neutral column set above. Registered for every provider."""

    def __init__(self, provider: str) -> None:
        self.provider = provider

    def parse(self, data: bytes) -> ParseResult:
        result = ParseResult()

        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            # A file that is not text at all is a whole-file problem, reported
            # as row 0 so it reaches the same exceptions queue rather than a
            # different error path an accountant has never seen.
            result.problems.append({"row": 0, "reason": "The file is not valid UTF-8 text."})
            return result

        reader = csv.DictReader(io.StringIO(text))
        headers = {name.strip().lower() for name in (reader.fieldnames or [])}
        missing = [column for column in REQUIRED_COLUMNS if column not in headers]
        if missing:
            result.problems.append(
                {"row": 0, "reason": f"Missing column(s): {', '.join(missing)}."}
            )
            return result

        for index, raw in enumerate(reader, start=2):  # 1 is the header.
            row = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items()}
            problem = self._row_problem(row)
            if problem:
                result.problems.append({"row": index, "reason": problem, **_echo(row)})
                continue
            result.rows.append(
                SettlementFileRow(
                    consumer_number=row["consumer_number"],
                    transaction_reference=row["transaction_reference"],
                    amount=Decimal(row["amount"]),
                    paid_on=datetime.date.fromisoformat(row["paid_on"]),
                    row_number=index,
                )
            )
        return result

    def _row_problem(self, row: dict[str, str]) -> str | None:
        for column in REQUIRED_COLUMNS:
            if not row.get(column):
                return f"'{column}' is empty."
        try:
            if Decimal(row["amount"]) <= 0:
                return "Amount must be positive."
        except InvalidOperation, ArithmeticError:
            return f"'{row['amount']}' is not an amount."
        try:
            datetime.date.fromisoformat(row["paid_on"])
        except ValueError:
            return f"'{row['paid_on']}' is not an ISO date (YYYY-MM-DD)."
        return None


def _echo(row: dict[str, str]) -> dict:
    """Carry the identifying fields into the exception so it is actionable.

    An exceptions queue saying only "row 47 was wrong" makes an accountant open
    the file; one carrying the reference and amount lets them fix it in place.
    """
    return {
        "provider_reference": row.get("transaction_reference") or None,
        "amount": row.get("amount") or None,
    }


# Registered for all three providers: until a real layout is confirmed, every
# provider is read the same way. A confirmed format replaces one line here.
for _provider in VoucherProvider.values:
    register_adapter(GenericCsvAdapter(_provider))
