"""Enable Row-Level Security on the tables added in 0003.

``feature_flags`` gets no policy — it is not tenant-owned (no ``tenant_id``
column, matching ``permissions``/``tenants``) and is not a ``TenantOwnedModel``
subclass, so ``tests/test_rls_coverage.py`` never expects one for it.
"""

from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [
        ("tenancy", "0003_featureflag_tenantcounter_tenantfeatureoverride"),
    ]

    operations = [
        *rls_operations("tenant_feature_overrides", "tenant_counters"),
    ]
