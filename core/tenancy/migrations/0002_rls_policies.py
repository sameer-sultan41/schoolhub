"""Enable Row-Level Security on the first tenant-owned tables.

Each module app repeats this pattern in its own first migration using
``core.tenancy.rls.rls_operations(...)``. tests/test_rls_coverage.py fails the
build if a tenant-owned table ever ships without a policy.
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
