"""Enable Row-Level Security on every table this module owns.

`class_subjects` is absent deliberately: the model belongs to
school_organization, and its own `0002_rls_policies` already covers the table.
Listing it here would attempt a duplicate policy.
"""

from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [("academics", "0001_initial")]
    operations = [
        *rls_operations("teacher_subject_allocations", "student_promotions"),
    ]
