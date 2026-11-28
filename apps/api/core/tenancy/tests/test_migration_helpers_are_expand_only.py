"""Pin the migration helpers to the shapes the deploy's migration guard accepts.

`.github/scripts/check_migrations.py` lets `*rls_operations(...)` and
`*append_only_operations(...)` through without reading their SQL when they act on a
table created in the same release. That is only safe while the helpers' forward SQL
stays expand-only; this test fails if either gains a DROP, DISABLE or NO FORCE.
"""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path
from types import ModuleType

from django.test import SimpleTestCase

from core.tenancy.grants import append_only_operations
from core.tenancy.rls import rls_operations

CHECKER = Path(__file__).resolve().parents[5] / ".github" / "scripts" / "check_migrations.py"
# The tenant policy may be re-created on its own table; nothing else may be dropped.
POLICY_RECREATION = re.compile(r"DROP\s+POLICY\s+IF\s+EXISTS\s+\w+\s+ON\s+\w+\s*;", re.IGNORECASE)


def _load_checker() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_migrations", CHECKER)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MigrationHelpersAreExpandOnlyTests(SimpleTestCase):
    def setUp(self) -> None:
        self.checker = _load_checker()

    def forward_sql(self) -> list[str]:
        operations = [
            *rls_operations("t"),
            *append_only_operations("t", mutable_columns={"t": ["c"]}),
        ]
        return [str(op.sql) for op in operations]

    def test_helper_forward_sql_is_expand_only(self) -> None:
        for sql in self.forward_sql():
            with self.subTest(sql=sql):
                self.assertIsNone(self.checker.scan_sql(POLICY_RECREATION.sub(" ", sql)))

    def test_helper_forward_sql_never_drops_or_disables(self) -> None:
        for sql in self.forward_sql():
            upper = sql.upper()
            for forbidden in ("DROP TABLE", "DISABLE ROW LEVEL SECURITY", "NO FORCE"):
                with self.subTest(forbidden=forbidden):
                    self.assertNotIn(forbidden, upper)
