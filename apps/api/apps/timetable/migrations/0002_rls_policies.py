"""Enable Row-Level Security on every table this module owns.

All four tables are new here — timetable.md §15 says they are *structurally*
specified in entities/academics.md but owned by this module, and no other app's
migrations touch them, so none of academics' "already covered elsewhere"
exclusions apply.
"""

from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [("timetable", "0001_initial")]
    operations = [
        *rls_operations("rooms", "periods", "timetable_slots", "teacher_substitutions"),
    ]
