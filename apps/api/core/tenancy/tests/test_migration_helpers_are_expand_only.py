"""Pin the migration helpers to the shapes the deploy's migration guard accepts.

`.github/scripts/check_migrations.py` lets `*rls_operations(...)` and
`*append_only_operations(...)` through without reading their SQL when they act on a
table created in the same release. That is only safe while the helpers' forward SQL
stays what they are for: enable and force RLS, create the tenant policy, revoke
mutations. This test removes exactly those statements and fails if anything the guard
flags is left, or if either helper gains a DROP, DISABLE or NO FORCE.
"""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path
from types import ModuleType

from django.test import SimpleTestCase

from core.tenancy.grants import append_only_operations
from core.tenancy.rls import rls_operations

SCANNER = Path(__file__).resolve().parents[5] / ".github" / "scripts" / "migration_sql.py"
# The statements the helpers exist to emit, which the guard accepts on a new table only.
HELPER_STATEMENTS = re.compile(
    r"ALTER\s+TABLE\s+\w+\s+(ENABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY\s*;"
    r"|CREATE\s+POLICY\s+\w+\s+ON\s+\w+[^;]*;"
    r"|REVOKE\s+UPDATE,\s*DELETE\s+ON\s+TABLE\s+\w+\s+FROM\s+\w+\s*;",
    re.IGNORECASE,
)


def _load_scanner() -> ModuleType:
    spec = importlib.util.spec_from_file_location("migration_sql", SCANNER)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MigrationHelpersAreExpandOnlyTests(SimpleTestCase):
    def setUp(self) -> None:
        self.scanner = _load_scanner()

    def forward_sql(self) -> list[str]:
        operations = [
            *rls_operations("t"),
            *append_only_operations("t", mutable_columns={"t": ["c"]}),
        ]
        return [str(op.sql) for op in operations]

    def test_helper_forward_sql_is_only_the_accepted_statements(self) -> None:
        for sql in self.forward_sql():
            with self.subTest(sql=sql):
                self.assertIsNone(self.scanner.scan_sql(HELPER_STATEMENTS.sub(" ", sql)))

    def test_helper_forward_sql_never_drops_or_disables(self) -> None:
        for sql in self.forward_sql():
            upper = sql.upper()
            for forbidden in ("DROP", "DISABLE ROW LEVEL SECURITY", "NO FORCE"):
                with self.subTest(forbidden=forbidden):
                    self.assertNotIn(forbidden, upper)
