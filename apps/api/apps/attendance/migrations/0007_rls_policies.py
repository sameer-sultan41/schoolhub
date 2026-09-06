"""Enable Row-Level Security on `staff_attendance`.

The last tenant-owned table this module adds. `tests/test_rls_coverage.py` fails
the build without it — and this one carries a named employee's daily arrival and
departure times, which is both personal data and a payroll input.
"""

from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [("attendance", "0006_staff_attendance")]
    operations = [*rls_operations("staff_attendance")]
