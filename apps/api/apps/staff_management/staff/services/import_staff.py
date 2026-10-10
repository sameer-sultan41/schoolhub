"""Bulk staff import: the per-row create (module doc §16).

Mirrors student_management's importer (same two formats, same
header-driven contract, same one-transaction-per-row independence); the file
itself is read by `core.imports.tabular`, the parser every importer shares.
"""

from __future__ import annotations

import datetime
import uuid
from collections.abc import Mapping
from typing import TYPE_CHECKING

from django.db import DataError, IntegrityError
from django.db.models import Field

from apps.staff_management.models import Gender, Staff
from apps.staff_management.staff.services.create import create_staff
from core.api.exceptions import DomainRuleViolation
from core.imports.tabular import ROW_NUMBER_KEY
from core.tenancy.context import tenant_atomic

if TYPE_CHECKING:
    from apps.school_organization.models import Campus

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


# The free-text Staff columns an import row can overflow; checked against the model's
# max_length so one long value fails its own row, not the whole job.
_LENGTH_CHECKED_COLUMNS = (
    "first_name",
    "last_name",
    "phone",
    "email",
    "national_id",
)


def import_staff_row(
    *,
    row: dict[str, str],
    tenant_id: uuid.UUID,
    actor_id: uuid.UUID,
    campuses_by_code: Mapping[str, Campus],
) -> dict[str, str] | None:
    """Create one staff record from a parsed import row.

    Returns ``None`` on success, or ``{"row", "field", "issue"}`` on failure.
    Each row commits (or rolls back) independently — one bad row must not
    abort the whole batch. Like import_student_row it checks gender, each date
    (reported against its own column) and text-column lengths before the insert.

    ``campuses_by_code`` is resolved once per file by the task, so a row costs no
    campus query; a code missing from it is reported as unknown.

    The reported row number comes from ``row[ROW_NUMBER_KEY]`` (set by
    ``core.imports.tabular`` for both CSV and .xlsx) rather than the row's position in
    the parsed list — a blank physical row is silently dropped by the parser, so a
    by-position index would drift from the real file row after the first one.
    """
    row_number = row[ROW_NUMBER_KEY]

    def error(field: str, issue: str) -> dict[str, str]:
        return {"row": row_number, "field": field, "issue": issue}

    missing = [column for column in REQUIRED_IMPORT_COLUMNS if not row.get(column)]
    if missing:
        return error(missing[0], f"Missing required value for '{missing[0]}'.")

    # Optional; blank falls back to the model default. The column's choices are not
    # enforced by the database, so an unchecked value would be stored as-is.
    gender = (row.get("gender") or "").strip().lower() or None
    if gender is not None and gender not in Gender.values:
        return error("gender", f"Must be one of: {', '.join(Gender.values)}.")

    dates: dict[str, datetime.date | None] = {}
    for column in ("joining_date", "date_of_birth"):
        text = (row.get(column) or "").strip()
        try:
            dates[column] = datetime.date.fromisoformat(text) if text else None
        except ValueError:
            return error(column, "Must be a date in YYYY-MM-DD format.")
    joining_date = dates["joining_date"]
    assert joining_date is not None  # joining_date is required, so it is never blank here

    for column in _LENGTH_CHECKED_COLUMNS:
        model_field = Staff._meta.get_field(column)
        # get_field()'s return type also covers reverse relations, which have no max_length.
        limit = model_field.max_length if isinstance(model_field, Field) else None
        if limit is not None and len(row.get(column) or "") > limit:
            return error(column, f"Must be at most {limit} characters.")

    campus = campuses_by_code.get(row["campus_code"])
    if campus is None:
        return error("campus_code", f"No campus with code '{row['campus_code']}'.")

    # One transaction for the whole row (tenant GUC re-applied via
    # tenant_atomic) — this is what makes each row commit independently.
    try:
        with tenant_atomic(tenant_id):
            create_staff(
                campus=campus,
                joining_date=joining_date,
                first_name=row["first_name"],
                last_name=row["last_name"],
                staff_type=row["staff_type"],
                phone=row["phone"],
                gender=gender,
                date_of_birth=dates["date_of_birth"],
                email=row.get("email") or None,
                national_id=row.get("national_id") or None,
                actor_id=actor_id,
                tenant_id=tenant_id,
            )
    except DomainRuleViolation as exc:
        detail = exc.detail
        if isinstance(detail, dict) and detail:
            field, issue = next(iter(detail.items()))
            return error(str(field), str(issue))
        return error("non_field", str(detail))
    except IntegrityError:
        return error("non_field", "This row conflicts with existing data.")
    except DataError:
        # Backstop for a column the length check above doesn't cover.
        return error("non_field", "A value in this row doesn't fit its column.")
    return None
