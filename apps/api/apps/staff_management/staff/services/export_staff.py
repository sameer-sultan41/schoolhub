"""Full-tenant staff export as CSV (module doc §16, `staff.staff.export`)."""

from __future__ import annotations

import uuid

from apps.staff_management.models import Staff
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
    with tenant_atomic(tenant_id):
        staff_rows = list(
            Staff.objects.alive().select_related("campus").order_by("last_name", "first_name")
        )
    for staff in staff_rows:
        writer.writerow(
            [
                staff.employee_number,
                staff.first_name,
                staff.last_name,
                staff.staff_type,
                staff.campus.code,
                staff.employment_status,
                staff.joining_date.isoformat(),
            ]
        )
    return buffer.getvalue().encode("utf-8")
