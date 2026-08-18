"""Guards the isolation invariant itself.

A tenant-owned table that ships without a Row-Level Security policy is a silent
data-leak between schools. These tests make that failure loud and unmissable at
build time rather than at breach time.
"""

from django.db import connection
from django.test import TestCase

from core.tenancy.rls import tenant_owned_tables


def _tables_with_rls_enabled() -> set[str]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT c.relname
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = current_schema()
              AND c.relkind = 'r'
              AND c.relrowsecurity
            """
        )
        return {row[0] for row in cursor.fetchall()}


def _tables_with_forced_rls() -> set[str]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT c.relname
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = current_schema()
              AND c.relkind = 'r'
              AND c.relforcerowsecurity
            """
        )
        return {row[0] for row in cursor.fetchall()}


def _tables_with_policies() -> set[str]:
    with connection.cursor() as cursor:
        cursor.execute("SELECT tablename FROM pg_policies WHERE schemaname = current_schema()")
        return {row[0] for row in cursor.fetchall()}


class RLSCoverageTests(TestCase):
    def test_every_tenant_owned_table_has_rls_enabled(self):
        expected = set(tenant_owned_tables())
        missing = expected - _tables_with_rls_enabled()
        self.assertEqual(
            missing,
            set(),
            f"Tenant-owned tables without RLS enabled: {sorted(missing)}. "
            f"Add core.tenancy.rls.rls_operations('<table>') to the app's migration.",
        )

    def test_every_tenant_owned_table_forces_rls(self):
        """FORCE matters: without it the table owner silently bypasses every policy."""
        expected = set(tenant_owned_tables())
        missing = expected - _tables_with_forced_rls()
        self.assertEqual(
            missing,
            set(),
            f"Tenant-owned tables without FORCE ROW LEVEL SECURITY: {sorted(missing)}",
        )

    def test_every_tenant_owned_table_has_a_policy(self):
        expected = set(tenant_owned_tables())
        missing = expected - _tables_with_policies()
        self.assertEqual(
            missing, set(), f"Tenant-owned tables with RLS but no policy: {sorted(missing)}"
        )

    def test_tenant_owned_models_declare_tenant_column(self):
        from django.apps import apps

        from core.tenancy.models import TenantOwnedModel

        offenders = [
            model._meta.label
            for model in apps.get_models()
            if issubclass(model, TenantOwnedModel)
            and not any(f.name == "tenant" for f in model._meta.fields)
        ]
        self.assertEqual(offenders, [], f"Tenant-owned models without a tenant FK: {offenders}")
