"""Enable Row-Level Security on this app's tenant-owned tables.

Kept separate from the generated schema migration so ``makemigrations --check``
stays clean: Django owns 0001, and the isolation policy is layered on top. Every
module app repeats this pattern in a migration of its own, and
``tests/test_rls_coverage.py`` fails the build if one forgets.
"""

from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [
        ("tenancy", "0001_initial"),
    ]

    operations = [
        *rls_operations("tenant_settings"),
    ]
