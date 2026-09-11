"""Bulk staff import: file parsing plus the per-row create (module doc §16).

Mirrors student_management's importer exactly (same two formats, same
header-driven contract, same one-transaction-per-row independence).
"""

from __future__ import annotations

import uuid

from django.db import IntegrityError

from apps.staff_management.staff.services.create import create_staff
from core.api.exceptions import DomainRuleViolation
from core.tenancy.context import tenant_atomic

# Column mapping for arbitrary legacy headers is not built (same gap as
# student_management's importer) — the template's exact header names are
# required. Optional columns may be blank; REQUIRED_IMPORT_COLUMNS must all
# have a value.
IMPORT_COLUMNS = (
    "first_name",
    "last_name",
    "staff_type",
    "campus_code",
    "joining_date",
    "phone",
    "gender",
    "date_of_birth",
    "email",
    "national_id",
)
REQUIRED_IMPORT_COLUMNS = (
    "first_name",
    "last_name",
    "staff_type",
    "campus_code",
    "joining_date",
    "phone",
)


def parse_import_rows(*, filename: str, data: bytes) -> list[dict[str, str]]:
    """Parse a staff-import file (CSV or .xlsx) into row dicts keyed by

    IMPORT_COLUMNS's header names — mirrors student_management's parser
    exactly (same two formats, same header-driven contract).
    """
    if filename.lower().endswith(".xlsx"):
        return _parse_import_xlsx(data)
    return _parse_import_csv(data)


def _parse_import_csv(data: bytes) -> list[dict[str, str]]:
    import csv
    import io

    # utf-8-sig strips a BOM if Excel's "CSV UTF-8" added one.
    text = data.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    rows: list[dict[str, str]] = []
    for row in reader:
        entry = {k: (v or "") for k, v in row.items()}
        # DictReader silently skips a fully blank physical line (row == []), so a plain
        # by-position index would drift from the real file row the moment one appears.
        # reader.line_num already accounts for every line consumed, skipped or not.
        entry["__row_number__"] = str(reader.line_num)
        rows.append(entry)
    return rows


def _parse_import_xlsx(data: bytes) -> list[dict[str, str]]:
    import io

    import openpyxl

    workbook = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    sheet = workbook.active
    rows_iter = sheet.iter_rows(values_only=True)
    header = [str(cell).strip() if cell is not None else "" for cell in next(rows_iter)]

    rows: list[dict[str, str]] = []
    for sheet_row, values in enumerate(rows_iter, start=2):  # header occupies row 1
        if all(value is None for value in values):
            # Skipped, not appended — a plain by-position index into `rows` would
            # otherwise drift from the real sheet row the moment one of these appears.
            # __row_number__ below is what keeps every downstream error message correct.
            continue
        try:
            entry = {
                header[i]: ("" if values[i] is None else str(values[i])) for i in range(len(header))
            }
        except IndexError:
            # A row with fewer trailing cells than the header — record it as a
            # per-row error instead of failing the whole import (see
            # import_staff_row's matching __parse_error__ check below).
            entry = {"__parse_error__": f"Row {sheet_row} has fewer columns than the header row."}
        entry["__row_number__"] = str(sheet_row)
        rows.append(entry)
    return rows


def import_staff_row(
    *, row: dict[str, str], tenant_id: uuid.UUID, actor_id: uuid.UUID
) -> dict[str, str] | None:
    """Create one staff record from a parsed import row.

    Returns ``None`` on success, or ``{"row", "field", "issue"}`` on failure.
    Each row commits (or rolls back) independently — one bad row must not
    abort the whole batch, mirroring import_student_row exactly.

    The reported row number comes from ``row["__row_number__"]`` (set by both
    ``_parse_import_csv`` and ``_parse_import_xlsx``) rather than the row's position in
    the parsed list — a blank physical row is silently dropped by both parsers, so a
    by-position index would drift from the real file row after the first one.
    """
    import datetime

    from apps.school_organization.models import Campus

    row_number = row["__row_number__"]

    if "__parse_error__" in row:
        return {"row": row_number, "field": "non_field", "issue": row["__parse_error__"]}

    missing = [column for column in REQUIRED_IMPORT_COLUMNS if not row.get(column)]
    if missing:
        field = missing[0]
        return {
            "row": row_number,
            "field": field,
            "issue": f"Missing required value for '{field}'.",
        }

    try:
        joining_date = datetime.date.fromisoformat(row["joining_date"])
        date_of_birth = (
            datetime.date.fromisoformat(row["date_of_birth"]) if row.get("date_of_birth") else None
        )
    except ValueError:
        return {
            "row": row_number,
            "field": "joining_date",
            "issue": "Dates must be in YYYY-MM-DD format.",
        }

    # One transaction for the whole row (tenant GUC re-applied via
    # tenant_atomic) — this is what makes each row commit independently.
    try:
        with tenant_atomic(tenant_id):
            try:
                campus = Campus.objects.alive().get(code=row["campus_code"])
            except Campus.DoesNotExist:
                return {
                    "row": str(row_number),
                    "field": "campus_code",
                    "issue": f"No campus with code '{row['campus_code']}'.",
                }
            except Campus.MultipleObjectsReturned:
                # The campus-code uniqueness constraint is scoped to non-deleted rows
                # only, so a code reused after a soft-delete can match more than one
                # row here without .alive() — report it as an import error rather than
                # letting the exception fail the whole batch.
                return {
                    "row": str(row_number),
                    "field": "campus_code",
                    "issue": f"More than one campus has code '{row['campus_code']}'.",
                }
            create_staff(
                campus=campus,
                joining_date=joining_date,
                first_name=row["first_name"],
                last_name=row["last_name"],
                staff_type=row["staff_type"],
                phone=row["phone"],
                gender=row.get("gender") or None,
                date_of_birth=date_of_birth,
                email=row.get("email") or None,
                national_id=row.get("national_id") or None,
                actor_id=actor_id,
                tenant_id=tenant_id,
            )
    except DomainRuleViolation as exc:
        detail = exc.detail
        if isinstance(detail, dict) and detail:
            field, issue = next(iter(detail.items()))
            return {"row": str(row_number), "field": str(field), "issue": str(issue)}
        return {"row": str(row_number), "field": "non_field", "issue": str(detail)}
    except IntegrityError:
        return {
            "row": str(row_number),
            "field": "non_field",
            "issue": "This row conflicts with existing data.",
        }
    return None
