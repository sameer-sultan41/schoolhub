"""AST helpers for check_migrations.py: read Django migration source without importing Django.

Stdlib only. Everything here is pure: source text in, AST nodes or sets of names out.
"""

from __future__ import annotations

import ast
import re
from collections.abc import Iterable, Mapping
from pathlib import Path

FieldKey = tuple[str, str, str]  # app label, lower-cased model name, field name
ModelKey = tuple[str, str]  # app label, lower-cased model name
PriorLookup = Mapping[FieldKey, ast.Call]

MIGRATION_PATH = re.compile(r"^apps/api/(?:.+/)?([^/]+)/migrations/[0-9][^/]*\.py$")

MISSING = object()


def callee(node: ast.expr) -> str | None:
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Name):
        return node.id
    return None


def arg(call: ast.Call, name: str, position: int) -> ast.expr | None:
    for kw in call.keywords:
        if kw.arg == name:
            return kw.value
    if len(call.args) > position:
        return call.args[position]
    return None


def literal_str(node: ast.expr | None) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def literal_kw(call: ast.Call, name: str) -> object:
    """A keyword's literal value; MISSING when absent; raises ValueError when not literal."""
    for kw in call.keywords:
        if kw.arg == name:
            return ast.literal_eval(kw.value)
    return MISSING


def app_label(path: str) -> str:
    match = MIGRATION_PATH.match(path)
    return match.group(1) if match else Path(path).parent.parent.name


def migration_operations(tree: ast.Module) -> list[ast.expr] | None:
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == "Migration":
            for stmt in node.body:
                targets: list[ast.expr] = []
                value: ast.expr | None = None
                if isinstance(stmt, ast.Assign):
                    targets, value = stmt.targets, stmt.value
                elif isinstance(stmt, ast.AnnAssign):
                    targets, value = [stmt.target], stmt.value
                if any(isinstance(t, ast.Name) and t.id == "operations" for t in targets):
                    if isinstance(value, ast.List | ast.Tuple):
                        return list(value.elts)
                    return None
    return None


def module_constants(tree: ast.Module) -> dict[str, str]:
    constants = {}
    for node in tree.body:
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and literal_str(node.value) is not None
        ):
            constants[node.targets[0].id] = literal_str(node.value) or ""
    return constants


def fields_of(call: ast.Call) -> list[tuple[str, ast.Call]]:
    """(field name, field Call) pairs of a CreateModel's `fields=[...]`."""
    fields = arg(call, "fields", 1)
    pairs = []
    if isinstance(fields, ast.List | ast.Tuple):
        for elt in fields.elts:
            if isinstance(elt, ast.Tuple) and len(elt.elts) == 2:
                name = literal_str(elt.elts[0])
                if name is not None and isinstance(elt.elts[1], ast.Call):
                    pairs.append((name, elt.elts[1]))
    return pairs


def iter_operations(ops: Iterable[ast.expr]) -> Iterable[ast.Call]:
    """Every operation Call, recursing into SeparateDatabaseAndState's database half."""
    for op in ops:
        if not isinstance(op, ast.Call):
            continue
        if callee(op.func) == "SeparateDatabaseAndState":
            db_ops = arg(op, "database_operations", 99)
            if isinstance(db_ops, ast.List | ast.Tuple):
                yield from iter_operations(db_ops.elts)
            continue
        yield op


def prior_definitions(sources: Iterable[tuple[str, str]]) -> dict[FieldKey, ast.Call]:
    """The last definition of every field, reading migrations in filename order."""
    defs: dict[FieldKey, ast.Call] = {}
    for path, source in sorted(sources):
        try:
            tree = ast.parse(source)
        except SyntaxError:
            continue
        ops = migration_operations(tree)
        if ops is None:
            continue
        app = app_label(path)
        for call in iter_operations(ops):
            name = callee(call.func)
            if name == "CreateModel":
                model = literal_str(arg(call, "name", 0))
                if model is None:
                    continue
                for field_name, field in fields_of(call):
                    defs[(app, model.lower(), field_name)] = field
            elif name in {"AddField", "AlterField"}:
                model = literal_str(arg(call, "model_name", 0))
                field_name = literal_str(arg(call, "name", 1))
                field = arg(call, "field", 2)
                if model and field_name and isinstance(field, ast.Call):
                    defs[(app, model.lower(), field_name)] = field
    return defs


def defined_fields(sources: Iterable[tuple[str, str]]) -> set[FieldKey]:
    """Fields created (CreateModel or AddField) by these migrations, never AlterField."""
    keys: set[FieldKey] = set()
    for path, source in sources:
        try:
            tree = ast.parse(source)
        except SyntaxError:
            continue
        app = app_label(path)
        for call in iter_operations(migration_operations(tree) or []):
            name = callee(call.func)
            if name == "CreateModel":
                model = literal_str(arg(call, "name", 0))
                if model:
                    keys |= {(app, model.lower(), f) for f, _ in fields_of(call)}
            elif name == "AddField":
                model = literal_str(arg(call, "model_name", 0))
                field_name = literal_str(arg(call, "name", 1))
                if model and field_name:
                    keys.add((app, model.lower(), field_name))
    return keys


def created_tables(sources: Iterable[tuple[str, str]]) -> set[str]:
    """Tables created by CreateModel: its db_table option, else <app_label>_<model>."""
    tables = set()
    for path, source in sources:
        try:
            tree = ast.parse(source)
        except SyntaxError:
            continue
        for call in iter_operations(migration_operations(tree) or []):
            if callee(call.func) != "CreateModel":
                continue
            model = literal_str(arg(call, "name", 0))
            if model is None:
                continue
            table = f"{app_label(path)}_{model.lower()}"
            options = arg(call, "options", 3)
            if isinstance(options, ast.Dict):
                for key, value in zip(options.keys, options.values, strict=True):
                    if key is not None and literal_str(key) == "db_table" and literal_str(value):
                        table = literal_str(value) or table
            tables.add(table)
    return tables


def created_models(sources: Iterable[tuple[str, str]]) -> set[ModelKey]:
    """(app label, model) pairs created by CreateModel in these migrations."""
    models: set[ModelKey] = set()
    for path, source in sources:
        try:
            tree = ast.parse(source)
        except SyntaxError:
            continue
        for call in iter_operations(migration_operations(tree) or []):
            if callee(call.func) == "CreateModel":
                model = literal_str(arg(call, "name", 0))
                if model:
                    models.add((app_label(path), model.lower()))
    return models

