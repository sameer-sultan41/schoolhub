"""One walk over the backend's own source, for contract tests that read code instead of running it.

test_import_boundaries.py and test_endpoint_contracts.py check rules no linter expresses by
parsing every module under apps/ and core/. Sharing the walk keeps their scope identical and
stops the next such test from copying it again. Tests and migrations are out of scope: test
factories legitimately cross apps, and migrations are generated.

Not a test module (no `test_` prefix), so the runner imports it only through those tests.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from functools import cache
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
SOURCE_PACKAGES = ("apps", "core")
OUT_OF_SCOPE = frozenset({"tests", "migrations"})


@dataclass(frozen=True)
class SourceModule:
    path: Path  # absolute
    relative: str  # "apps/academics/curriculum/viewset.py"
    name: str  # dotted module name; a package's __init__.py is the package itself
    package: str  # what relative imports inside this module resolve against
    tree: ast.Module


@cache
def source_modules() -> tuple[SourceModule, ...]:
    """Every non-test, non-migration module under apps/ and core/, parsed once per test run."""
    modules: list[SourceModule] = []
    for top in SOURCE_PACKAGES:
        for path in sorted((API_ROOT / top).rglob("*.py")):
            parts = path.relative_to(API_ROOT).with_suffix("").parts
            if OUT_OF_SCOPE.intersection(parts):
                continue
            is_package = parts[-1] == "__init__"
            name = ".".join(parts[:-1] if is_package else parts)
            modules.append(
                SourceModule(
                    path=path,
                    relative=path.relative_to(API_ROOT).as_posix(),
                    name=name,
                    package=name if is_package else name.rpartition(".")[0],
                    tree=ast.parse(path.read_text(encoding="utf-8"), filename=str(path)),
                )
            )
    return tuple(modules)
