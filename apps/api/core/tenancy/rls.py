"""Helpers for generating Row-Level Security policy SQL.

Every tenant-owned table gets the same pair of statements. Keeping the SQL in one
place means a new module app enables RLS by calling ``rls_operations("its_table")``
in its first migration rather than hand-writing policy SQL.

See docs/02-architecture/database-architecture.md and multi-tenancy.md §3.
"""

from django.db import migrations

TENANT_GUC = "app.tenant_id"

# FORCE ROW LEVEL SECURITY matters: without it the table *owner* bypasses policies,
# which would silently disable isolation whenever migrations and the app share a role.
_ENABLE = """
ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
CREATE POLICY {policy} ON {table}
    USING (tenant_id = NULLIF(current_setting('{guc}', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('{guc}', true), '')::uuid);
"""

_DISABLE = """
DROP POLICY IF EXISTS {policy} ON {table};
ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;
ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;
"""


def enable_rls_sql(table: str) -> str:
    return _ENABLE.format(table=table, policy=f"{table}_tenant_isolation", guc=TENANT_GUC)


def disable_rls_sql(table: str) -> str:
    return _DISABLE.format(table=table, policy=f"{table}_tenant_isolation")


def rls_operations(*tables: str) -> list[migrations.RunSQL]:
    """Return reversible RunSQL operations enabling RLS on each table."""
    return [
        migrations.RunSQL(sql=enable_rls_sql(table), reverse_sql=disable_rls_sql(table))
        for table in tables
    ]


def tenant_owned_tables() -> list[str]:
    """Every table that must carry an RLS policy.

    Derived from the models at call time so a new tenant-owned model cannot be
    forgotten — the CI check in tests/test_rls_coverage.py compares this against
    the policies actually present in the database.
    """
    from django.apps import apps

    from core.tenancy.models import TenantOwnedModel

    tables = []
    for model in apps.get_models():
        if issubclass(model, TenantOwnedModel) and not model._meta.abstract:
            tables.append(model._meta.db_table)
    return sorted(tables)
