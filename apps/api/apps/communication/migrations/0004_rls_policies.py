"""Enable Row-Level Security on the two tables this migration adds.

Adding a table to this app means adding it here too; ``tests/test_rls_coverage.py``
compares the models against the policies actually present in the database and
fails the build on any omission.
"""

from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [("communication", "0003_announcement_notice")]
    operations = [
        *rls_operations("announcements", "notices"),
    ]
