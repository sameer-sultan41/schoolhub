"""Cross-app import rules (ADR-0013), checked by reading the source rather than trusting review.

- `core/` imports no app.
- An app never imports another app's `views`, `viewsets`, `viewset`, `view`, `urls`, `reports`
  or `tasks` modules. Importing another app's `models` is fine (foreign keys, querysets);
  changing its data goes through that app's `services`.

Tests and migrations are out of scope: test factories legitimately cross apps, and migrations
are generated.

Why a contract test rather than import-linter: a forbidden contract can't express "another
app's views, but not your own" without one contract per app, and this repo already keeps its
architectural rules as tests that walk the code (test_rls_coverage.py,
test_endpoint_contracts.py). KNOWN_VIOLATIONS is the baseline: it may only shrink — the test
fails on a new violation *and* on an entry that no longer occurs, and the `lint-baselines` CI
job (.github/scripts/check_baselines_shrink.py) fails on an added entry. That job reads the set
with `ast.literal_eval`, so keep it a plain literal: spelled-out tuples, no comprehensions.
"""

from __future__ import annotations

import ast

from django.test import SimpleTestCase

from tests.source_tree import source_modules

# "viewsets" as well as the documented singular: it is DRF's idiomatic name and core/api uses it.
INTERNAL_MODULES = frozenset({"views", "viewsets", "viewset", "view", "urls", "reports", "tasks"})

# (importing module, imported target). Remove an entry when its import is fixed — the test
# fails until you do, so the list can't go stale.
KNOWN_VIOLATIONS = frozenset(
    {
        # Shared destroy guard; belongs in school_organization's services or core/api.
        ("apps.academics.curriculum.viewset", "apps.school_organization.views"),
        # Attendance summary for report cards; belongs in attendance's services.
        ("apps.examinations.services", "apps.attendance.reports"),
        # Seed commands build cross-module fixtures; they move to a top-level seeding package.
        # One entry per app, so a seed command reaching into a NEW app still fails.
        ("core.rbac.management.commands.seed_all_roles", "apps.academics"),
        ("core.rbac.management.commands.seed_all_roles", "apps.school_organization"),
        ("core.rbac.management.commands.seed_all_roles", "apps.staff_management"),
        ("core.rbac.management.commands.seed_all_roles", "apps.student_management"),
        ("core.rbac.management.commands.seed_all_roles", "apps.timetable"),
        ("core.rbac.management.commands.seed_e2e_data", "apps.academics"),
        ("core.rbac.management.commands.seed_e2e_data", "apps.attendance"),
        ("core.rbac.management.commands.seed_e2e_data", "apps.school_organization"),
        ("core.rbac.management.commands.seed_e2e_data", "apps.staff_management"),
        ("core.rbac.management.commands.seed_e2e_data", "apps.student_management"),
        ("core.rbac.management.commands.seed_e2e_data", "apps.timetable"),
    }
)


def _imported_modules(tree: ast.AST, package: str = "") -> set[str]:
    """Every import as an absolute module path, `from x import y` counted as both `x` and `x.y`
    (y may be a module). Relative imports are resolved against `package`, the importing
    module's package — `from ..school_organization import views` inside `apps.academics` is
    `apps.school_organization.views`. Lazy imports inside functions count too."""
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                anchor = package.split(".")[: len(package.split(".")) - (node.level - 1)]
                base = ".".join([*anchor, node.module] if node.module else anchor)
            else:
                base = node.module or ""
            if base:
                found.add(base)
                found.update(f"{base}.{alias.name}" for alias in node.names)
    return found


def _violation(source: str, target: str) -> str | None:
    """The normalised target this import breaks a rule on, or None if it's allowed."""
    target_parts = target.split(".")
    if target_parts[0] != "apps" or len(target_parts) < 2:
        return None
    source_parts = source.split(".")
    if source_parts[0] == "core":
        return ".".join(target_parts[:2])
    # len > 1: apps/__init__.py is the namespace itself, not an app, so it has no "other app".
    if source_parts[0] == "apps" and len(source_parts) > 1 and target_parts[1] != source_parts[1]:
        for index, part in enumerate(target_parts[2:], start=2):
            if part in INTERNAL_MODULES:
                return ".".join(target_parts[: index + 1])
    return None


def find_violations() -> set[tuple[str, str]]:
    violations: set[tuple[str, str]] = set()
    for module in source_modules():
        for target in _imported_modules(module.tree, module.package):
            broken = _violation(module.name, target)
            if broken:
                violations.add((module.name, broken))
    return violations


class ImportBoundaryTests(SimpleTestCase):
    def test_no_new_cross_app_import_violations(self):
        new = sorted(find_violations() - KNOWN_VIOLATIONS)
        self.assertEqual(
            new,
            [],
            "ADR-0013: core imports no app, and apps never import another app's "
            "views/viewsets/viewset/view/urls/reports/tasks — go through that app's services "
            "instead:\n" + "\n".join(f"  {source} -> {target}" for source, target in new),
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
        self.assertIsNone(
            _violation("apps.examinations.services", "apps.student_management.models")
        )

    def test_another_apps_views_are_not(self):
        self.assertEqual(
            _violation("apps.timetable.slots.viewset", "apps.academics.curriculum.viewset.Foo"),
            "apps.academics.curriculum.viewset",
        )

    def test_your_own_apps_views_are_allowed(self):
        self.assertIsNone(_violation("apps.timetable.rooms.viewset", "apps.timetable.views"))

    def test_core_may_not_import_any_app(self):
        self.assertEqual(
            _violation("core.notifications.services", "apps.communication.models"),
            "apps.communication",
        )

    def test_from_import_of_a_module_counts_as_that_module(self):
        tree = ast.parse("def f():\n    from apps.attendance import reports\n")
        self.assertIn("apps.attendance.reports", _imported_modules(tree))

    def test_relative_imports_resolve_against_the_package(self):
        tree = ast.parse("from ..school_organization import views\n")
        self.assertIn("apps.school_organization.views", _imported_modules(tree, "apps.academics"))

    def test_non_app_imports_are_ignored(self):
        self.assertIsNone(_violation("apps.timetable.views", "core.api.pagination"))

    def test_another_apps_plural_viewsets_module_is_not_allowed(self):
        self.assertEqual(
            _violation("apps.timetable.views", "apps.academics.viewsets.CurriculumViewSet"),
            "apps.academics.viewsets",
        )

    def test_the_apps_namespace_package_itself_is_not_an_app(self):
        # apps/__init__.py normalises to the one-part name "apps"; it must not raise IndexError.
        self.assertIsNone(_violation("apps", "apps.attendance.views"))
