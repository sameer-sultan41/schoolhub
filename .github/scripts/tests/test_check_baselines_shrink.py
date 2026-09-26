"""Tests for .github/scripts/check_baselines_shrink.py (ADR-0014), run by repo-hygiene.yml."""

from __future__ import annotations

import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / ".github" / "scripts"))
import check_baselines_shrink as shrink  # its directory is put on sys.path just above


class GrowthTests(unittest.TestCase):
    def test_fewer_or_equal_counts_pass(self) -> None:
        before = {"src/a.tsx": {"max-lines": {"count": 1}, "no-console": {"count": 3}}}
        after = {"src/a.tsx": {"no-console": {"count": 2}}}
        self.assertEqual(shrink.growth(before, after, {}), [])

    def test_higher_count_fails(self) -> None:
        before = {"src/a.tsx": {"no-console": {"count": 1}}}
        after = {"src/a.tsx": {"no-console": {"count": 2}}}
        self.assertEqual(len(shrink.growth(before, after, {})), 1)

    def test_new_file_key_fails(self) -> None:
        after = {"src/new.tsx": {"no-console": {"count": 1}}}
        self.assertEqual(len(shrink.growth({}, after, {})), 1)

    def test_renamed_file_carries_its_entries(self) -> None:
        before = {"src/old.tsx": {"no-console": {"count": 2}}}
        after = {"src/__tests__/old.tsx": {"no-console": {"count": 2}}}
        self.assertEqual(shrink.growth(before, after, {"src/__tests__/old.tsx": "src/old.tsx"}), [])


class EndToEnd(unittest.TestCase):
    """main() against a throwaway git repo with a workspace baseline."""

    def setUp(self) -> None:
        self._cwd = os.getcwd()
        self._tmp = tempfile.TemporaryDirectory()
        os.chdir(self._tmp.name)
        self._git("init", "-q")
        self._write({"src/a.tsx": {"no-console": {"count": 2}}})
        Path("apps/web/src").mkdir(parents=True, exist_ok=True)
        Path("apps/web/src/a.tsx").write_text("x\n", encoding="utf-8")
        self._git("add", "-A")
        self._git("commit", "-q", "-m", "base")

    def tearDown(self) -> None:
        os.chdir(self._cwd)
        self._tmp.cleanup()

    def _git(self, *args: str) -> None:
        subprocess.run(
            ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", *args], check=True, capture_output=True
        )

    def _write(self, data: dict) -> None:
        path = Path("apps/web/eslint-suppressions.json")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data), encoding="utf-8")

    def run_main(self, ref: str) -> int:
        # Capture stdout: the script prints `::error::` lines that Actions would annotate.
        with contextlib.redirect_stdout(io.StringIO()):
            return shrink.main(["check_baselines_shrink.py", ref])

    def test_shrinking_passes(self) -> None:
        self._write({"src/a.tsx": {"no-console": {"count": 1}}})
        self.assertEqual(self.run_main("HEAD"), 0)

    def test_growing_fails(self) -> None:
        self._write({"src/a.tsx": {"no-console": {"count": 3}}})
        self.assertEqual(self.run_main("HEAD"), 1)

    def test_an_empty_base_baseline_is_still_checked(self) -> None:
        # Four workspaces start with `{}`: a new entry there must fail, not pass as "new".
        self._write({})
        self._git("add", "-A")
        self._git("commit", "-q", "-m", "empty baseline")
        self._write({"src/a.tsx": {"no-restricted-syntax": {"count": 1}}})
        self.assertEqual(self.run_main("HEAD"), 1)

    def test_keys_for_deleted_files_fail(self) -> None:
        Path("apps/web/src/a.tsx").unlink()
        self.assertEqual(self.run_main("HEAD"), 1)

    def test_moving_a_file_keeps_its_suppressions(self) -> None:
        Path("apps/web/src/__tests__").mkdir(parents=True, exist_ok=True)
        self._git("mv", "apps/web/src/a.tsx", "apps/web/src/__tests__/a.tsx")
        self._write({"src/__tests__/a.tsx": {"no-console": {"count": 2}}})
        self.assertEqual(self.run_main("HEAD"), 0)


class KnownViolationsParsing(unittest.TestCase):
    def test_literal_with_generators_is_evaluated_without_importing(self):
        source = (
            "KNOWN_VIOLATIONS = frozenset({\n"
            "    ('apps.a.x', 'apps.b.views'),\n"
            "    *(('core.seed', f'apps.{app}') for app in ('c', 'd')),\n"
            "})\n"
        )
        self.assertEqual(
            shrink.known_violations(source),
            {("apps.a.x", "apps.b.views"), ("core.seed", "apps.c"), ("core.seed", "apps.d")},
        )


class BackendBaselines(unittest.TestCase):
    """Ratcheted noqa counts and KNOWN_VIOLATIONS against a throwaway repo."""

    BOUNDARIES = "KNOWN_VIOLATIONS = frozenset({('apps.a.x', 'apps.b.views')})\n"

    def setUp(self) -> None:
        self._cwd = os.getcwd()
        self._tmp = tempfile.TemporaryDirectory()
        os.chdir(self._tmp.name)
        subprocess.run(["git", "init", "-q"], check=True)
        Path("apps/api/tests").mkdir(parents=True)
        Path("apps/api/tasks.py").write_text("try:\n    x()\nexcept Exception:  # noqa: BLE001\n    pass\n")
        Path("apps/api/tests/test_import_boundaries.py").write_text(self.BOUNDARIES)
        Path("apps/api/pyproject.toml").write_text('[tool.ruff.lint]\nselect = ["E", "BLE", "TID251"]\n')
        subprocess.run(["git", "add", "-A"], check=True)
        subprocess.run(
            ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "base"], check=True
        )

    def tearDown(self) -> None:
        os.chdir(self._cwd)
        self._tmp.cleanup()

    def test_unchanged_baselines_pass(self) -> None:
        self.assertEqual(shrink.backend_growth("HEAD"), [])

    def test_a_new_ratcheted_noqa_fails(self) -> None:
        with Path("apps/api/tasks.py").open("a") as f:
            f.write("try:\n    y()\nexcept Exception:  # noqa: BLE001\n    pass\n")
        self.assertEqual(len(shrink.backend_growth("HEAD")), 1)

    def test_removing_a_noqa_passes(self) -> None:
        Path("apps/api/tasks.py").write_text("x()\n")
        self.assertEqual(shrink.backend_growth("HEAD"), [])

    def test_the_pr_that_first_selects_a_rule_may_create_its_baseline(self) -> None:
        Path("apps/api/pyproject.toml").write_text('[tool.ruff.lint]\nselect = ["E"]\n')
        subprocess.run(["git", "add", "-A"], check=True)
        subprocess.run(
            ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "unselect"], check=True
        )
        with Path("apps/api/tasks.py").open("a") as f:
            f.write("try:\n    y()\nexcept Exception:  # noqa: BLE001\n    pass\n")
        self.assertEqual(shrink.backend_growth("HEAD"), [])

    def test_a_new_known_violation_fails(self) -> None:
        Path("apps/api/tests/test_import_boundaries.py").write_text(
            "KNOWN_VIOLATIONS = frozenset({('apps.a.x', 'apps.b.views'), ('apps.c.y', 'apps.d.tasks')})\n"
        )
        self.assertEqual(len(shrink.backend_growth("HEAD")), 1)


if __name__ == "__main__":
    unittest.main()
