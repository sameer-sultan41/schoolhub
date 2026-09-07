"""Helpers for revoking mutation grants on append-only tables.

``core/audit/migrations/0003_audit_immutable.py`` was the first table to need
this and carries the argument in its own docstring: "The model refuses updates
and deletes in Python, but an audit trail the application can rewrite is not
evidence." A ledger is the second, and the same sentence applies to money —
AGENTS.md invariant 4. Rather than copy the SQL a third time, it lives here.

Two details in the SQL below are load-bearing and easy to drop:

* ``FROM PUBLIC`` first. Without it, a role that inherits PUBLIC's privileges
  keeps what was only revoked from ``schoolhub_app``.
* The ``pg_roles`` existence guard. ``schoolhub_app`` is the production and CI
  application role, but a developer's local database or an ad-hoc test database
  may not have it, and a migration that fails there is a migration people learn
  to skip.

The audit migration is deliberately left untouched — a migration already applied
in production is never edited. This module is for tables that come after it.

See docs/02-architecture/database-architecture.md and AGENTS.md invariant 4.
"""

from django.db import migrations

APP_ROLE = "schoolhub_app"

_REVOKE = """
REVOKE UPDATE, DELETE ON TABLE {table} FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
        REVOKE UPDATE, DELETE ON TABLE {table} FROM {role};
    END IF;
END
$$;
"""

# Ordered after the blanket revoke on purpose: a column-level GRANT UPDATE is
# narrower than the table-level one it follows, so PostgreSQL ends up allowing
# UPDATE of exactly these columns and nothing else. A full-row UPDATE — which is
# what an ordinary Django save() emits — still touches columns outside the grant
# and is still refused.
_GRANT_COLUMNS = """
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
        GRANT UPDATE ({columns}) ON TABLE {table} TO {role};
    END IF;
END
$$;
"""

_RESTORE = """
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
        GRANT UPDATE, DELETE ON TABLE {table} TO {role};
    END IF;
END
$$;
"""


def revoke_mutations_sql(table: str, *, mutable_columns: list[str] | None = None) -> str:
    sql = _REVOKE.format(table=table, role=APP_ROLE)
    if mutable_columns:
        sql += _GRANT_COLUMNS.format(
            table=table, role=APP_ROLE, columns=", ".join(sorted(mutable_columns))
        )
    return sql


def restore_mutations_sql(table: str) -> str:
    return _RESTORE.format(table=table, role=APP_ROLE)


def append_only_operations(
    *tables: str, mutable_columns: dict[str, list[str]] | None = None
) -> list[migrations.RunSQL]:
    """Return reversible RunSQL operations making each table append-only.

    ``mutable_columns`` maps a table to the columns that stay updatable — the
    back-reference case, where a later row supersedes an earlier one and has to
    say so on it. Keep the list identical to the model's ``MUTABLE_FIELDS``;
    ``tests/test_append_only_coverage.py`` fails the build if they diverge.
    """
    per_table = mutable_columns or {}
    return [
        migrations.RunSQL(
            sql=revoke_mutations_sql(table, mutable_columns=per_table.get(table)),
            reverse_sql=restore_mutations_sql(table),
        )
        for table in tables
    ]


def append_only_tables() -> dict[str, frozenset[str]]:
    """Every table that must have its mutation grants revoked, to its allowance.

    Derived from the models at call time, the same way
    ``core.tenancy.rls.tenant_owned_tables()`` is, so a new append-only model
    cannot be forgotten.
    """
    from django.apps import apps

    from core.tenancy.models import AppendOnlyTenantModel

    return {
        model._meta.db_table: frozenset(model.MUTABLE_FIELDS)
        for model in apps.get_models()
        if issubclass(model, AppendOnlyTenantModel) and not model._meta.abstract
    }
