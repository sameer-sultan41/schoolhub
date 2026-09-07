"""Enable Row-Level Security on `marks`.

New in `0005_marks` and touched by no other app's migrations, so none of the
"already covered elsewhere" exclusions other modules carry apply.

`apps/api/tests/test_rls_coverage.py` fails the build without it, and this table
earns it plainly: a mark is a named child's academic record before anyone has
approved or published it, and it is the input every grade on a report card is
computed from.
"""

from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [("examinations", "0005_marks")]
    operations = [*rls_operations("marks")]
