"""Guards AGENTS.md invariant 4 — money is append-only.

``test_rls_coverage.py`` does this job for tenant isolation: derive the list of
tables that must be protected from the models, then ask the database whether
they actually are. This is the same check for mutation grants.

It matters because the Python guards are not the boundary. ``AppendOnlyTenantModel``
refuses ``save()`` and ``delete()``, and ``AppendOnlyQuerySet`` refuses the bulk
forms — but a raw ``connection.cursor()`` walks past all of them, and so does
any code path that reaches the table through a manager nobody thought about.
Only the revoked grant stops those, and only this test notices when a new table
ships without it.
"""

from django.db import connection
from django.test import TestCase

from core.tenancy.grants import APP_ROLE, append_only_tables


def _grants(table: str, privilege: str) -> set[str]:
    """Grantees holding `privilege` on `table` at table level (not per column)."""
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT grantee
            FROM information_schema.table_privileges
            WHERE table_schema = current_schema()
              AND table_name = %s
              AND privilege_type = %s
            """,
            [table, privilege],
        )
        return {row[0] for row in cursor.fetchall()}


def _column_grants(table: str, privilege: str) -> dict[str, set[str]]:
    """Grantee -> columns holding `privilege` on `table` at column level."""
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT grantee, column_name
            FROM information_schema.column_privileges
            WHERE table_schema = current_schema()
              AND table_name = %s
              AND privilege_type = %s
            """,
            [table, privilege],
        )
        grants: dict[str, set[str]] = {}
        for grantee, column in cursor.fetchall():
            grants.setdefault(grantee, set()).add(column)
        return grants


class AppendOnlyCoverageTests(TestCase):
    def test_at_least_one_append_only_table_exists(self) -> None:
        """A guard on the guard.

        Every assertion below iterates the derived table list, so an empty list
        makes all of them pass while proving nothing. If the append-only base is
        ever refactored out from under this file, fail here rather than go quiet.
        """
        self.assertNotEqual(
            append_only_tables(),
            {},
            "No AppendOnlyTenantModel subclasses found — this file is asserting nothing.",
        )

    def test_every_append_only_table_has_delete_revoked(self) -> None:
        offenders = [
            table for table in append_only_tables() if APP_ROLE in _grants(table, "DELETE")
        ]
        self.assertEqual(
            offenders,
            [],
            f"Append-only tables the application role can still DELETE from: {offenders}. "
            f"Add core.tenancy.grants.append_only_operations('<table>') to the app's migration.",
        )

    def test_every_append_only_table_has_table_wide_update_revoked(self) -> None:
        """Table-level UPDATE, which is what an ordinary ``save()`` needs.

        A column-level grant does not appear here, so a table with one mutable
        column still passes — and a full-row rewrite of it still fails, which is
        the distinction the whole design rests on.
        """
        offenders = [
            table for table in append_only_tables() if APP_ROLE in _grants(table, "UPDATE")
        ]
        self.assertEqual(
            offenders,
            [],
            f"Append-only tables the application role can still UPDATE wholesale: {offenders}",
        )

    def test_the_mutable_column_allowance_matches_the_model(self) -> None:
        """The Python allowance and the database grant must name the same columns.

        Two declarations of one rule drift. If ``MUTABLE_FIELDS`` grows a column
        and the migration does not, the model permits a write the database then
        refuses — a 500 in a code path whose tests passed.
        """
        mismatches = {}
        for table, mutable_fields in append_only_tables().items():
            granted = _column_grants(table, "UPDATE").get(APP_ROLE, set())
            if granted != set(mutable_fields):
                mismatches[table] = {
                    "model_MUTABLE_FIELDS": sorted(mutable_fields),
                    "database_grant": sorted(granted),
                }
        self.assertEqual(
            mismatches,
            {},
            "MUTABLE_FIELDS and the migration's mutable_columns disagree: "
            f"{mismatches}. Keep append_only_operations(mutable_columns=...) in step "
            "with the model.",
        )
