"""Cross-app import rules (ADR-0013), checked by reading the source rather than trusting review.

- `core/` imports no app.
- An app never imports another app's `views`, `viewset`, `view`, `urls`, `reports` or `tasks`
  modules. Importing another app's `models` is fine (foreign keys, querysets); changing its data
  goes through that app's `services`.

Tests and migrations are out of scope: test factories legitimately cross apps, and migrations
are generated.

Why a contract test rather than import-linter: a forbidden contract can't express "another
app's views, but not your own" without one contract per app, and this repo already keeps its
architectural rules as tests that walk the code (test_rls_coverage.py,
test_endpoint_contracts.py). KNOWN_VIOLATIONS is the baseline: it may only shrink — the test
fails on a new violation *and* on an entry that no longer occurs.
"""

from __future__ import annotations

import ast
from pathlib import Path

from django.test import SimpleTestCase

API_ROOT = Path(__file__).resolve().parents[1]
INTERNAL_MODULES = frozenset({"views", "viewset", "view", "urls", "reports", "tasks"})

# (importing module, imported target). Remove an entry when its import is fixed — the test
# fails until you do, so the list can't go stale.
KNOWN_VIOLATIONS = frozenset(
    {
        # Shared destroy guard; belongs in school_organization's services or core/api.
        ("apps.academics.curriculum.viewset", "apps.school_organization.views"),
        # Attendance summary for report cards; belongs in attendance's services.
        ("apps.examinations.services", "apps.attendance.reports"),
        # Seed commands build cross-module fixtures; they move to a top-level seeding package.
        ("core.rbac.management.commands.seed_all_roles", "apps"),
        ("core.rbac.management.commands.seed_e2e_data", "apps"),
    }
)


def _module_name(path: Path) -> str:
    parts = path.relative_to(API_ROOT).with_suffix("").parts
    return ".".join(parts[:-1] if parts[-1] == "__init__" else parts)


def _imported_modules(tree: ast.AST) -> set[str]:
    """Absolute imports, including `from x import y` as both `x` and `x.y` (y may be a module)."""
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            found.add(node.module)
            found.update(f"{node.module}.{alias.name}" for alias in node.names)
    return found


def _violation(source: str, target: str) -> str | None:
    """The normalised target this import breaks a rule on, or None if it's allowed."""
    target_parts = target.split(".")
    if target_parts[0] != "apps" or len(target_parts) < 2:
        return None
    source_parts = source.split(".")
    if source_parts[0] == "core":
        return "apps"
    if source_parts[0] == "apps" and target_parts[1] != source_parts[1]:
        for index, part in enumerate(target_parts[2:], start=2):
            if part in INTERNAL_MODULES:
                return ".".join(target_parts[: index + 1])
    return None


def find_violations() -> set[tuple[str, str]]:
    violations: set[tuple[str, str]] = set()
    for package in ("apps", "core"):
        for path in (API_ROOT / package).rglob("*.py"):
            relative = path.relative_to(API_ROOT).parts
            if "tests" in relative or "migrations" in relative:
                continue
            source = _module_name(path)
            for target in _imported_modules(ast.parse(path.read_text(encoding="utf-8"))):
                broken = _violation(source, target)
                if broken:
                    violations.add((source, broken))
    return violations


class ImportBoundaryTests(SimpleTestCase):
    def test_no_new_cross_app_import_violations(self):
        new = sorted(find_violations() - KNOWN_VIOLATIONS)
        self.assertEqual(
            new,
            [],
            "ADR-0013: core imports no app, and apps never import another app's "
            "views/viewset/urls/reports/tasks — go through that app's services instead:\n"
            + "\n".join(f"  {source} -> {target}" for source, target in new),
        )

    def test_known_violations_list_only_shrinks(self):
        fixed = sorted(KNOWN_VIOLATIONS - find_violations())
        self.assertEqual(
            fixed,
            [],
            "These imports are gone — delete them from KNOWN_VIOLATIONS:\n"
            + "\n".join(f"  {source} -> {target}" for source, target in fixed),
        )


class ViolationRuleTests(SimpleTestCase):
    """The rule itself, on synthetic imports."""

    def test_another_apps_models_are_allowed(self):
        self.assertIsNone(_violation("apps.examinations.services", "apps.student_management.models"))

    def test_another_apps_views_are_not(self):
        self.assertEqual(
            _violation("apps.timetable.slots.viewset", "apps.academics.curriculum.viewset.Foo"),
            "apps.academics.curriculum.viewset",
        )

    def test_your_own_apps_views_are_allowed(self):
        self.assertIsNone(_violation("apps.timetable.rooms.viewset", "apps.timetable.views"))

    def test_core_may_not_import_any_app(self):
        self.assertEqual(_violation("core.notifications.services", "apps.communication.models"), "apps")

    def test_non_app_imports_are_ignored(self):
        self.assertIsNone(_violation("apps.timetable.views", "core.api.pagination"))
