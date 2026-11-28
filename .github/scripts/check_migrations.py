#!/usr/bin/env python3
"""Deploy gate: are the migrations between two SHAs expand-only?

    check_migrations.py --base <sha|none> --target <sha> [--repo <path>] [--json <out>]
                        [--summary <md>] [--allow-contract] [--acknowledge-review]

The deploy runs migrations before it rolls out new code, so for a few minutes the
previous release runs against the new schema. Every migration must therefore be
"expand" (old code keeps working). This script reads each migration added between
the deployed SHA (`--base`) and the SHA being deployed (`--target`) with `ast`, never
importing Django, and classifies every operation:

* contract: the old code breaks (a dropped, renamed or narrowed column, a raw DROP);
* review: the checker cannot prove it safe (RunPython, code-built operations);
* pass.

Exit codes: 0 clean (or every finding overridden), 1 a contract finding,
4 review findings only, 2 a usage or git error (never overridable).
`--allow-contract` and `--acknowledge-review` apply the overrides here, so the
callers (deploy.yml `preview`, deploy-env.yml) pass their inputs straight through.
"""

from __future__ import annotations

import argparse
import ast
import json
import subprocess
import sys
from collections.abc import Iterable, Mapping
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal

# Sibling modules: this directory is sys.path[0] when the script runs, and the tests
# put it there.
from migration_ast import (
    MIGRATION_PATH,
    FieldKey,
    ModelKey,
    PriorLookup,
    app_label,
    arg,
    callee,
    literal_kw,
    migration_operations,
    module_constants,
    literal_str,
    created_models,
    created_tables,
    defined_fields,
    prior_definitions,
)
from migration_sql import scan_sql

__all__ = [
    "FieldKey",
    "Finding",
    "classify_source",
    "created_models",
    "created_tables",
    "defined_fields",
    "main",
    "prior_definitions",
    "scan_sql",
]

CONTRACT_OPS = {
    "RemoveField",
    "DeleteModel",
    "RenameField",
    "RenameModel",
    "RemoveConstraint",
    "AlterModelTable",
}
REVIEW_OPS = {"RunPython", "AlterUniqueTogether", "AlterIndexTogether", "AlterOrderWithRespectTo"}
PASS_OPS = {
    "CreateModel",
    "AddIndex",
    "RemoveIndex",
    "RenameIndex",
    "AlterModelOptions",
    "AlterModelManagers",
    "AlterModelTableComment",
}
ALLOWED_HELPERS = {"rls_operations", "append_only_operations"}
# A many-to-many field adds a join table, not a column on the model's table.
NO_COLUMN_FIELDS = {"ManyToManyField"}
NARROWING_KEYS = ("max_length", "max_digits", "decimal_places")


@dataclass(frozen=True)
class Finding:
    path: str
    line: int
    operation: str
    severity: Literal["contract", "review"]
    reason: str


# --- classification ----------------------------------------------------------------


def _classify_add_field(call: ast.Call) -> tuple[str, str] | None:
    field = arg(call, "field", 2)
    if not isinstance(field, ast.Call):
        return ("review", "AddField with a field the checker cannot read")
    if callee(field.func) in NO_COLUMN_FIELDS:
        return None
    # Any db_default (a literal or an expression such as Now()) gives the column a
    # database default, so the running code's inserts still succeed.
    if any(kw.arg == "db_default" for kw in field.keywords):
        return None
    try:
        null = literal_kw(field, "null")
    except ValueError:
        return ("review", "AddField: null is not a literal")
    if null is True:
        return None
    return (
        "contract",
        "AddField NOT NULL without db_default: the running code inserts rows without it",
    )


def _classify_alter_field(
    call: ast.Call, app: str, prior: PriorLookup, new_fields: set[FieldKey]
) -> tuple[str, str] | None:
    model = literal_str(arg(call, "model_name", 0))
    name = literal_str(arg(call, "name", 1))
    new = arg(call, "field", 2)
    if model is None or name is None or not isinstance(new, ast.Call):
        return ("review", "AlterField the checker cannot read")
    key = (app, model.lower(), name)
    old = prior.get(key)
    if old is None:
        if key in new_fields:
            return None
        return ("review", "AlterField: cannot find the deployed definition")
    if callee(old.func) != callee(new.func):
        return ("contract", f"AlterField changes the type ({callee(old.func)} -> {callee(new.func)})")
    try:
        old_null, new_null = literal_kw(old, "null"), literal_kw(new, "null")
        if old_null is True and new_null is not True:
            return ("contract", "AlterField sets NOT NULL: the running code may write NULL")
        for key_name in NARROWING_KEYS:
            before, after = literal_kw(old, key_name), literal_kw(new, key_name)
            if (
                isinstance(before, int)
                and isinstance(after, int)
                and after < before
            ):
                return ("contract", f"AlterField narrows {key_name} ({before} -> {after})")
        if literal_kw(old, "db_column") != literal_kw(new, "db_column"):
            return ("contract", "AlterField changes db_column: the running code reads the old name")
    except ValueError:
        return ("review", "AlterField: a compared keyword is not a literal")
    return None


def _run_sql_statements(call: ast.Call, constants: Mapping[str, str]) -> list[str] | None:
    node = arg(call, "sql", 0)

    def resolve(n: ast.expr) -> str | None:
        if literal_str(n) is not None:
            return literal_str(n)
        if isinstance(n, ast.Name):
            return constants.get(n.id)
        return None

    if node is None:
        return None
    single = resolve(node)
    if single is not None:
        return [single]
    if isinstance(node, ast.List | ast.Tuple):
        out = []
        for elt in node.elts:
            text = resolve(elt)
            if text is None and isinstance(elt, ast.Tuple) and elt.elts:
                text = resolve(elt.elts[0])
            if text is None:
                return None
            out.append(text)
        return out
    return None


def _classify_helper(call: ast.Call, new_tables: frozenset[str]) -> tuple[str, str] | None:
    review = (
        "review",
        "RLS or append-only change on an existing table: running code may lose access mid-deploy",
    )
    for arg in call.args:
        table = literal_str(arg)
        if table is None or table not in new_tables:
            return review
    for kw in call.keywords:
        if callee(call.func) != "append_only_operations" or kw.arg != "mutable_columns":
            return review
        if not isinstance(kw.value, ast.Dict):
            return review
        for key, value in zip(kw.value.keys, kw.value.values, strict=True):
            if key is None or literal_str(key) not in new_tables:
                return review
            if not isinstance(value, ast.List | ast.Tuple) or any(
                literal_str(e) is None for e in value.elts
            ):
                return review
    return None


def classify_source(
    source: str,
    path: str,
    prior: PriorLookup,
    new_fields: set[FieldKey],
    new_tables: frozenset[str] = frozenset(),
    new_models: frozenset[ModelKey] = frozenset(),
) -> list[Finding]:
    """Every contract or review finding in one added migration."""
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return [
            Finding(path, exc.lineno or 1, "SyntaxError", "contract",
                    "cannot parse: cannot prove this migration is expand-only")
        ]
    ops = migration_operations(tree)
    if ops is None:
        return [Finding(path, 1, "operations", "review",
                        "no literal Migration.operations list the checker can read")]
    constants = module_constants(tree)
    app = app_label(path)
    findings: list[Finding] = []

    def add(node: ast.AST, op: str, result: tuple[str, str] | None) -> None:
        if result is not None:
            severity = "contract" if result[0] == "contract" else "review"
            findings.append(Finding(path, getattr(node, "lineno", 1), op, severity, result[1]))

    def walk(elements: Iterable[ast.expr]) -> None:
        for op in elements:
            if isinstance(op, ast.Starred):
                inner = op.value
                if isinstance(inner, ast.Call) and callee(inner.func) in ALLOWED_HELPERS:
                    add(op, callee(inner.func) or "", _classify_helper(inner, new_tables))
                else:
                    add(op, "Starred", ("review", "operation built by code the checker cannot read"))
                continue
            if not isinstance(op, ast.Call):
                add(op, type(op).__name__,
                    ("review", "operation built by code the checker cannot read"))
                continue
            name = callee(op.func) or "?"
            if name == "SeparateDatabaseAndState":
                db_ops = arg(op, "database_operations", 99)
                if isinstance(db_ops, ast.List | ast.Tuple):
                    walk(db_ops.elts)
                elif db_ops is not None:
                    add(op, name, ("review", "database_operations the checker cannot read"))
            elif name in CONTRACT_OPS:
                add(op, name, ("contract", f"{name} breaks the running code"))
            elif name in PASS_OPS:
                continue
            elif name == "AddField":
                add(op, name, _classify_add_field(op))
            elif name == "AlterField":
                add(op, name, _classify_alter_field(op, app, prior, new_fields))
            elif name == "RunSQL":
                statements = _run_sql_statements(op, constants)
                if statements is None:
                    add(op, name, ("review", "RunSQL whose SQL the checker cannot read"))
                else:
                    results = [r for r in (scan_sql(sql) for sql in statements) if r]
                    contract = [r for r in results if r[0] == "contract"]
                    if results:
                        add(op, name, (contract or results)[0])
            elif name == "AddConstraint":
                # A new constraint on an existing table can refuse the running code's
                # writes; on a table created in this release nothing depends on it yet.
                model = literal_str(arg(op, "model_name", 0))
                if model is None or (app, model.lower()) not in new_models:
                    add(op, name, ("review", "AddConstraint on an existing table can refuse the running code's writes"))
            elif name in REVIEW_OPS:
                add(op, name, ("review", f"{name} needs a human look"))
            else:
                add(op, name, ("review", f"unknown operation {name}"))

    walk(ops)
    return findings


# --- git ---------------------------------------------------------------------------


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args], check=True, capture_output=True, text=True
    ).stdout


def changed_migrations(repo: Path, base: str, target: str) -> tuple[list[str], list[str], list[str]]:
    """(added, edited, deleted) migration paths between base and target."""
    out = _git(repo, "diff", "--name-status", "--no-renames", base, target, "--", "apps/api")
    added, edited, deleted = [], [], []
    for line in out.splitlines():
        status, _, path = line.partition("\t")
        if not MIGRATION_PATH.match(path):
            continue
        {"A": added, "M": edited, "D": deleted}.get(status[:1], []).append(path)
    return sorted(added), sorted(edited), sorted(deleted)


def _show(repo: Path, sha: str, path: str) -> str:
    return _git(repo, "show", f"{sha}:{path}")


def _tree_migrations(repo: Path, sha: str) -> list[str]:
    out = _git(repo, "ls-tree", "-r", "--name-only", sha, "--", "apps/api")
    return [p for p in out.splitlines() if MIGRATION_PATH.match(p)]


def collect_findings(repo: Path, base: str, target: str) -> list[Finding]:
    added, edited, deleted = changed_migrations(repo, base, target)
    added_sources = [(p, _show(repo, target, p)) for p in added]
    findings = [
        Finding(p, 1, "edited", "review",
                "an applied migration was edited; the edit never runs on a database that already applied it")
        for p in edited
    ]
    findings += [
        Finding(p, 1, "deleted", "contract", "a deployed migration was deleted")
        for p in deleted
    ]
    if not added_sources:
        return findings
    new_fields = defined_fields(added_sources)
    new_tables = frozenset(created_tables(added_sources))
    new_models = frozenset(created_models(added_sources))
    needs_prior = any("AlterField" in src for _, src in added_sources)
    prior: PriorLookup = (
        prior_definitions((p, _show(repo, base, p)) for p in _tree_migrations(repo, base))
        if needs_prior
        else {}
    )
    for path, source in added_sources:
        findings += classify_source(source, path, prior, new_fields, new_tables, new_models)
    return findings


# --- CLI ---------------------------------------------------------------------------


def _write_summary(path: str, base: str, target: str, findings: list[tuple[Finding, bool]]) -> None:
    lines = [f"### Migration guard: `{base[:7]}` → `{target[:7]}`", ""]
    if not findings:
        lines.append("No contract or review findings.")
    else:
        lines += ["| Severity | File | Line | Operation | Reason | Overridden |", "|---|---|---|---|---|---|"]
        for f, overridden in findings:
            lines.append(
                f"| {f.severity} | `{f.path}` | {f.line} | {f.operation} | {f.reason} | "
                f"{'yes' if overridden else 'no'} |"
            )
    with open(path, "a", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n\n")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--repo", default=".")
    parser.add_argument("--json", dest="json_out")
    parser.add_argument("--summary")
    parser.add_argument("--allow-contract", action="store_true")
    parser.add_argument("--acknowledge-review", action="store_true")
    try:
        args = parser.parse_args(argv[1:])
    except SystemExit:
        return 2
    repo = Path(args.repo)

    def write_json(rows: list[tuple[Finding, bool]]) -> None:
        if args.json_out:
            Path(args.json_out).write_text(json.dumps(
                {"base": args.base, "target": args.target,
                 "findings": [{**asdict(f), "overridden": o} for f, o in rows]},
                indent=2,
            ))

    if args.base == "none":
        print("first deploy: no running code, migration guard skipped")
        write_json([])
        return 0
    for label, sha in (("deployed", args.base), ("target", args.target)):
        probe = subprocess.run(
            ["git", "-C", str(repo), "cat-file", "-e", f"{sha}^{{commit}}"], capture_output=True
        )
        if probe.returncode != 0:
            print(f"::error::{label} SHA {sha} is not in this clone")
            return 2
    try:
        findings = collect_findings(repo, args.base, args.target)
    except subprocess.CalledProcessError as exc:
        print(f"::error::git failed: {exc.stderr.strip()}")
        return 2

    rows: list[tuple[Finding, bool]] = []
    for f in findings:
        flag = "--allow-contract" if f.severity == "contract" else "--acknowledge-review"
        overridden = args.allow_contract if f.severity == "contract" else args.acknowledge_review
        rows.append((f, overridden))
        level = "warning" if overridden else "error"
        suffix = f" (overridden by {flag})" if overridden else f" (override: {flag})"
        print(f"::{level} file={f.path},line={f.line}::{f.severity}: {f.operation}: {f.reason}{suffix}")
    write_json(rows)
    if args.summary:
        _write_summary(args.summary, args.base, args.target, rows)

    if any(f.severity == "contract" and not o for f, o in rows):
        return 1
    if any(f.severity == "review" and not o for f, o in rows):
        return 4
    print(f"migration guard: {len(rows)} finding(s), none blocking")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
