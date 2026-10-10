"""Reading an uploaded bulk-import file (CSV or .xlsx) into row dicts.

The one parser every importer shares — students, staff, attendance registers and
exam marks all take "a spreadsheet a school already has" — so the details that are
silently wrong in a reimplementation live once: the BOM Excel's "CSV UTF-8" adds,
openpyxl's read-only/data-only flags, date cells, and row numbers that match what
the user's spreadsheet shows even after a skipped blank row.

Rows are keyed by the file's own header names (whitespace-stripped). One reserved key
rides along on every row: ROW_NUMBER_KEY, the row's real line/sheet row as a string,
for the error report. For a CSV record whose quoted cell spans several lines, that is
the record's *last* physical line (csv.reader.line_num's documented behaviour).
"""

from __future__ import annotations

import csv
import datetime
import io
import zipfile
from collections.abc import Sequence

ROW_NUMBER_KEY = "__row_number__"


class ImportFileError(ValueError):
    """The whole file is unreadable. ``str()`` is shown to the importing user."""


def parse_rows(
    *, filename: str, data: bytes, required_columns: Sequence[str] = ()
) -> list[dict[str, str]]:
    if filename.lower().endswith(".xlsx"):
        header, rows = _parse_xlsx(data)
    else:
        header, rows = _parse_csv(data)
    if required_columns:
        if header is None:
            raise ImportFileError("The file is empty — it needs a header row.")
        missing = [column for column in required_columns if column not in header]
        if missing:
            raise ImportFileError(
                f"Missing required column(s): {', '.join(missing)}. "
                "Header names must match the template exactly."
            )
    return rows


def _parse_csv(data: bytes) -> tuple[list[str] | None, list[dict[str, str]]]:
    try:
        # utf-8-sig strips a BOM if Excel's "CSV UTF-8" added one.
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ImportFileError(
            'The file is not UTF-8 text. In Excel, save it as "CSV UTF-8" or as .xlsx.'
        ) from exc
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        return None, []
    reader.fieldnames = [name.strip() for name in reader.fieldnames]
    rows: list[dict[str, str]] = []
    for row in reader:
        entry = {k: (v or "") for k, v in row.items() if k is not None}
        # DictReader skips a fully blank line; line_num still counts it.
        entry[ROW_NUMBER_KEY] = str(reader.line_num)
        rows.append(entry)
    return list(reader.fieldnames), rows


def _parse_xlsx(data: bytes) -> tuple[list[str] | None, list[dict[str, str]]]:
    import openpyxl
    from openpyxl.utils.exceptions import InvalidFileException

    try:
        workbook = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except (zipfile.BadZipFile, InvalidFileException, KeyError) as exc:
        raise ImportFileError("The file is not a readable .xlsx workbook.") from exc
    try:
        sheet = workbook.active
        # Read-only mode trusts the file's stored size record, which some exporters
        # omit or get wrong (rows silently truncated, or only the header read).
        sheet.reset_dimensions()
        rows_iter = sheet.iter_rows(values_only=True)
        first = next(rows_iter, None)
        if first is None:
            return None, []
        header = [str(cell).strip() if cell is not None else "" for cell in first]
        rows: list[dict[str, str]] = []
        for sheet_row, values in enumerate(rows_iter, start=2):  # header is row 1
            if all(value is None for value in values):
                continue
            rows.append(_xlsx_row(header, values, sheet_row=sheet_row))
        return header, rows
    finally:
        workbook.close()


def _xlsx_row(header: list[str], values: tuple[object, ...], *, sheet_row: int) -> dict[str, str]:
    """A short row is padded with blanks, as csv.DictReader does (restval)."""
    padded = (*values, *([None] * (len(header) - len(values))))
    entry = {header[i]: _cell_text(padded[i]) for i in range(len(header))}
    entry[ROW_NUMBER_KEY] = str(sheet_row)
    return entry


def _cell_text(value: object) -> str:
    """A cell as the text a user would have typed — a date cell as YYYY-MM-DD."""
    if value is None:
        return ""
    if isinstance(value, datetime.datetime):
        return value.date().isoformat() if value.time() == datetime.time() else value.isoformat()
    if isinstance(value, datetime.date):
        return value.isoformat()
    return str(value)
