"""Enable Row-Level Security on the two tables `0003_scheduling` adds.

Both are new there and no other app's migrations touch them, so none of the
"already covered elsewhere" exclusions other modules carry apply.

`apps/api/tests/test_rls_coverage.py` fails the build without this, and both
tables earn it on their own terms: `exam_schedules` says where a named cohort of
children will be at a stated hour, and `admit_cards` carries the number that
admits one of them to a hall — a card leaking between schools is a card someone
else can present.
"""

from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [("examinations", "0003_scheduling")]
    operations = [*rls_operations("exam_schedules", "admit_cards")]
