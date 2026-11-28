"""Classify forward migration SQL as contract, review or expand-only.

Used by check_migrations.py for `RunSQL`, and loaded directly by the API's helper-pin test
(`apps/api/core/tenancy/tests/test_migration_helpers_are_expand_only.py`), so it imports
nothing from this directory. Stdlib only.

Contract: the release still running during the deploy breaks (a dropped, renamed or retyped
column, rows deleted, a privilege revoked, RLS weakened, a NOT NULL column it never writes).
Review: correct on a new table but able to hide rows or refuse writes on an existing one, and
the scanner cannot tell which table is new (RLS enabled or forced, a policy created, a
constraint added).
"""

from __future__ import annotations

import re
from typing import Literal

Severity = Literal["contract", "review"]

_COMMENT_LINE = re.compile(r"--[^\n]*")
_COMMENT_BLOCK = re.compile(r"/\*.*?\*/", re.DOTALL)
_STRING = re.compile(r"'(?:[^']|'')*'")
_DROP_NOT_NULL = re.compile(r"\bDROP\s+NOT\s+NULL\b")

# Each ADD [COLUMN] clause up to the next `, ADD`, `;` or the end. Table constraints
# (ADD CONSTRAINT / PRIMARY KEY / UNIQUE / FOREIGN KEY / CHECK) are not columns.
_ADD_COLUMN = re.compile(
    r"\bADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"
    r"(?!CONSTRAINT\b|PRIMARY\b|UNIQUE\b|FOREIGN\b|CHECK\b|EXCLUDE\b)"
    r"\S+\s+([^;]*?)(?=,\s*ADD\b|;|$)"
)

RULES: list[tuple[re.Pattern[str], Severity, str]] = [
    (re.compile(r"\bDROP\b"), "contract", "DROP removes something the running code may use"),
    (re.compile(r"\bRENAME\b"), "contract", "RENAME breaks the running code's names"),
    (
        re.compile(r"\bALTER\s+(TABLE\s+\S+\s+)?(ALTER\s+)?(COLUMN\s+)?\S+\s+(SET\s+DATA\s+)?TYPE\b"),
        "contract",
        "a column type change",
    ),
    (re.compile(r"\bSET\s+NOT\s+NULL\b"), "contract", "SET NOT NULL: the running code may write NULL"),
    (re.compile(r"\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b"), "contract", "disables RLS (invariant 1)"),
    (re.compile(r"\bNO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY\b"), "contract", "un-forces RLS (invariant 1)"),
    (re.compile(r"\bTRUNCATE\b"), "contract", "TRUNCATE deletes rows the running code reads"),
    (re.compile(r"\bDELETE\s+FROM\b"), "contract", "DELETE FROM deletes rows the running code reads"),
    (re.compile(r"\bUPDATE\s+\S+\s+SET\b"), "contract", "a data rewrite the running code does not expect"),
    # A revoked privilege fails the running code's queries at once; append-only tables go
    # through append_only_operations(), which the checker accepts only on new tables.
    (re.compile(r"\bREVOKE\b"), "contract", "REVOKE removes a privilege the running code may use"),
    (
        re.compile(r"(?<!NO\s)\bFORCE\s+ROW\s+LEVEL\s+SECURITY\b|\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b"),
        "review",
        "enables or forces RLS: on an existing table, queries without tenant context lose rows",
    ),
    (
        re.compile(r"\bCREATE\s+POLICY\b"),
        "review",
        "CREATE POLICY changes which rows the running code sees",
    ),
    (
        re.compile(r"\bADD\s+CONSTRAINT\b"),
        "review",
        "ADD CONSTRAINT can refuse writes the running code makes, and locks the table to validate",
    ),
]


def normalise(sql: str) -> str:
    """Upper-case SQL without comments or string literals, so neither can match a rule."""
    text = _COMMENT_BLOCK.sub(" ", sql)
    text = _COMMENT_LINE.sub(" ", text)
    return _STRING.sub("''", text).upper()


def scan_sql(sql: str) -> tuple[Severity, str] | None:
    """The worst finding in forward SQL (contract before review), or None if expand-only."""
    text = normalise(sql)
    text = _DROP_NOT_NULL.sub(" ", text)
    for clause in _ADD_COLUMN.finditer(text):
        definition = clause.group(1)
        if re.search(r"\bNOT\s+NULL\b", definition) and not re.search(r"\bDEFAULT\b", definition):
            return "contract", "RunSQL: ADD COLUMN NOT NULL without DEFAULT: the running code inserts rows without it"
    review: tuple[Severity, str] | None = None
    for pattern, severity, reason in RULES:
        if pattern.search(text):
            if severity == "contract":
                return "contract", f"RunSQL: {reason}"
            review = review or ("review", f"RunSQL: {reason}")
    return review
