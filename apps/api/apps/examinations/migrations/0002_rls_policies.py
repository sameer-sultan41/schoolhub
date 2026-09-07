"""Enable Row-Level Security on every table this module owns so far.

All four are new in `0001_initial` and no other app's migrations touch them, so
none of the "already covered elsewhere" exclusions other modules carry apply.

`apps/api/tests/test_rls_coverage.py` fails the build for any tenant-owned table
without a policy, which is the point. `grading_scales` and `grade_bands` look
like harmless reference data, and that is exactly why they need saying: a band
leaking between schools would not expose a child's record, it would silently
regrade one — a school reading another's scale is a school publishing results it
never computed.
"""

from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [("examinations", "0001_initial")]
    operations = [
        *rls_operations("grading_scales", "grade_bands", "exams", "exam_subjects"),
    ]
