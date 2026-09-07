"""Enable Row-Level Security on `results` and `report_cards`.

Both are new in `0007_results` and touched by no other app's migrations, so
none of the "already covered elsewhere" exclusions other modules carry apply.

`apps/api/tests/test_rls_coverage.py` fails the build without it, and these two
are the most consequential tables this module owns: a `results` row is the
figure a school defends to a parent, and a `report_cards` row links a rendered
document about a named child. A leak here is not a privacy incident in the
abstract — it is one school publishing another's grades.
"""

from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [("examinations", "0007_results")]
    operations = [*rls_operations("results", "report_cards")]
