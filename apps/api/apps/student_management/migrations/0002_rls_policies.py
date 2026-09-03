"""Enable Row-Level Security on every table this module owns.

Adding a table to this app means adding it here too; ``tests/test_rls_coverage.py``
compares the models against the policies actually present in the database and
fails the build on any omission.
"""

from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [
        ("student_management", "0001_initial"),
    ]

    operations = [
        *rls_operations("students"),
    ]
