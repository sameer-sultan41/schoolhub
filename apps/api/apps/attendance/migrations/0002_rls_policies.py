"""Enable Row-Level Security on every table this module owns.

Both tables are new here — no other app's migrations touch them, so none of the
"already covered elsewhere" exclusions other modules carry apply.

`tests/test_rls_coverage.py` fails the build for any tenant-owned table without a
policy, which is the point: a table shipped without one is a silent leak between
schools, and `student_attendance` is the most sensitive table this platform has
so far — it is a per-child, per-day record of where a named minor was.
"""

from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [("attendance", "0001_initial")]
    operations = [*rls_operations("student_attendance", "attendance_corrections")]
