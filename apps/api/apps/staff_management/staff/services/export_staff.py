"""Full-tenant staff export as CSV (module doc §16, `staff.staff.export`)."""

from __future__ import annotations

import uuid

from apps.staff_management.models import Staff
from core.exports.tabular import spreadsheet_safe_row
from core.tenancy.context import tenant_atomic


def build_staff_export_csv(*, tenant_id: uuid.UUID) -> bytes:
    """All of a tenant's staff as CSV (module doc §16, staff.staff.export).

    Not record-scope-narrowed: export is admin-only (STAFF_IO —
    hr_staff/it_admin) — mirrors build_student_export_csv's identical
    reasoning.
    """
    import csv
    import io

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "employee_number",
            "first_name",
            "last_name",
            "staff_type",
            "campus_code",
            "employment_status",
            "joining_date",
        ]
    )
    # `.iterator()`, not `list(...)`: a full-tenant export must not hold every Staff
    # row (and its related Campus) in memory as Python objects at once — this
    # streams from the DB cursor instead (chunk_size defaults to 2000). The whole
    # call, not just "later chunks", has to run inside `tenant_atomic`: `.iterator()`
    # runs no query until the first row is consumed, and by then the RLS policy
    # needs `app.tenant_id` set — and in prod, PgBouncer's transaction-pooling mode
    # (`server_reset_query_always`) tears down a server-side cursor the instant its
    # opening transaction ends, so the cursor itself would not survive past the
    # `with` block either way.
    # Known trade-off: this pins one pooled DB connection for the whole export —
    # see docs/deferred-work.md ("exports hold a pooled DB connection").
    with tenant_atomic(tenant_id):
        staff_rows = (
            Staff.objects.alive()
            .select_related("campus")
            .order_by("last_name", "first_name")
            .iterator()
        )
        for staff in staff_rows:
            # Every cell: names are user-typed, and the file opens in Excel
            # (deferred-work "CSV formula injection").
            writer.writerow(
                spreadsheet_safe_row(
                    (
                        staff.employee_number,
                        staff.first_name,
                        staff.last_name,
                        staff.staff_type,
                        staff.campus.code,
                        staff.employment_status,
                        staff.joining_date.isoformat(),
                    )
                )
            )
    return buffer.getvalue().encode("utf-8")
