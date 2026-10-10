"""Bulk staff import: the per-row create (module doc §16).

Mirrors student_management's importer (same two formats, same
header-driven contract, same one-transaction-per-row independence); the file
itself is read by `core.imports.tabular`, the parser every importer shares.
"""

from __future__ import annotations

import uuid

from django.db import IntegrityError

from apps.staff_management.staff.services.create import create_staff
from core.api.exceptions import DomainRuleViolation
from core.imports.tabular import ROW_NUMBER_KEY
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


def import_staff_row(
    *, row: dict[str, str], tenant_id: uuid.UUID, actor_id: uuid.UUID
) -> dict[str, str] | None:
    """Create one staff record from a parsed import row.

    Returns ``None`` on success, or ``{"row", "field", "issue"}`` on failure.
    Each row commits (or rolls back) independently — one bad row must not
    abort the whole batch, as import_student_row does (which additionally checks gender,
    each date and column lengths — see docs/deferred-work.md).

    The reported row number comes from ``row[ROW_NUMBER_KEY]`` (set by
    ``core.imports.tabular`` for both CSV and .xlsx) rather than the row's position in
    the parsed list — a blank physical row is silently dropped by the parser, so a
    by-position index would drift from the real file row after the first one.
    """
    import datetime

    from apps.school_organization.models import Campus

    row_number = row[ROW_NUMBER_KEY]

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
