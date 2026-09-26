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


class RuleSelection(unittest.TestCase):
    def test_letter_prefixes_must_match_exactly(self) -> None:
        # The bug this pins: the base's "B" (bugbear) once counted as selecting BLE001.
        self.assertFalse(shrink.rule_selects("B", "BLE001"))
        self.assertTrue(shrink.rule_selects("B", "B001"))

    def test_digit_prefixes_and_exact_codes(self) -> None:
        self.assertTrue(shrink.rule_selects("BLE", "BLE001"))
        self.assertTrue(shrink.rule_selects("TID", "TID251"))
        self.assertTrue(shrink.rule_selects("TID251", "TID251"))
        self.assertFalse(shrink.rule_selects("TID252", "TID251"))
        self.assertTrue(shrink.rule_selects("ALL", "BLE001"))


class KnownViolationsParsing(unittest.TestCase):
    PAIRS = {("apps.a.x", "apps.b.views"), ("core.seed", "apps.c")}

    def test_frozenset_literal(self) -> None:
        source = "KNOWN_VIOLATIONS = frozenset({\n    ('apps.a.x', 'apps.b.views'),\n    ('core.seed', 'apps.c'),\n})\n"
        self.assertEqual(shrink.known_violations(source), self.PAIRS)

    def test_annotated_assignment(self) -> None:
        # The bug this pins: an annotated constant once fell through to an empty set, and an
        # empty "before" or "after" makes every comparison pass.
        source = "KNOWN_VIOLATIONS: frozenset[tuple[str, str]] = frozenset({('apps.a.x', 'apps.b.views'), ('core.seed', 'apps.c')})\n"
        self.assertEqual(shrink.known_violations(source), self.PAIRS)

    def test_bare_set_literal(self) -> None:
        source = "KNOWN_VIOLATIONS = {('apps.a.x', 'apps.b.views'), ('core.seed', 'apps.c')}\n"
        self.assertEqual(shrink.known_violations(source), self.PAIRS)

    def test_empty_frozenset_is_an_empty_baseline(self) -> None:
        self.assertEqual(shrink.known_violations("KNOWN_VIOLATIONS = frozenset()\n"), set())

    def test_missing_assignment_raises(self) -> None:
        with self.assertRaises(ValueError):
            shrink.known_violations("VIOLATIONS = frozenset()\n")

    def test_non_literal_raises_instead_of_being_evaluated(self) -> None:
        source = "KNOWN_VIOLATIONS = frozenset({*(('core.seed', f'apps.{a}') for a in ('c',))})\n"
        with self.assertRaises(ValueError):
            shrink.known_violations(source)

    def test_wrong_shape_raises(self) -> None:
        with self.assertRaises(ValueError):
            shrink.known_violations("KNOWN_VIOLATIONS = frozenset({('apps.a.x',)})\n")


class NoqaCounting(unittest.TestCase):
    def test_codes_are_counted_in_every_form_ruff_accepts(self) -> None:
        text = "a  # noqa: E501, F401  reason\nb  #NOQA:E501\nc  # noqa: S105 S106\n"
        self.assertEqual(shrink.count_noqa(text), {"E501": 2, "F401": 1, "S105": 1, "S106": 1})

    def test_blanket_noqa_is_counted(self) -> None:
        # The bug this pins: a code-less `# noqa` silences every rule but was invisible.
        self.assertEqual(shrink.count_noqa("a  # noqa\nb  # noqa -- legacy\n"), {shrink.BLANKET: 2})

    def test_whitespace_before_the_colon_still_names_codes(self) -> None:
        self.assertEqual(shrink.count_noqa("a  # noqa : BLE001\n"), {"BLE001": 1})

    def test_file_level_forms_are_counted(self) -> None:
        text = "# ruff: noqa: BLE001\n#ruff:noqa\n# flake8: noqa\n# flake8: NOQA: E501\n"
        self.assertEqual(shrink.count_noqa(text), {"BLE001": 1, shrink.BLANKET: 2, "E501": 1})

    def test_bracketed_ruff_suppressions_are_counted(self) -> None:
        text = "# ruff: ignore[E501, F401]\n# ruff: file-ignore[BLE001]\n# ruff: disable[E501]\n# ruff: enable[E501]\n"
        self.assertEqual(shrink.count_noqa(text), {"E501": 2, "F401": 1, "BLE001": 1})

    def test_a_code_list_never_continues_onto_the_next_line(self) -> None:
        # "E2E_..." on the following line once read as a phantom code "E2".
        self.assertEqual(shrink.count_noqa("a  # noqa: BLE001\nE2E_TENANT = 1\n"), {"BLE001": 1})


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
        # "B" (bugbear) at the base must not count as having selected BLE.
        Path("apps/api/pyproject.toml").write_text('[tool.ruff.lint]\nselect = ["E", "B"]\n')
        subprocess.run(["git", "add", "-A"], check=True)
        subprocess.run(
            ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "unselect"], check=True
        )
        with Path("apps/api/tasks.py").open("a") as f:
            f.write("try:\n    y()\nexcept Exception:  # noqa: BLE001\n    pass\n")
        self.assertEqual(shrink.backend_growth("HEAD"), [])

    def test_a_new_blanket_noqa_fails(self) -> None:
        with Path("apps/api/tasks.py").open("a") as f:
            f.write("import os  # noqa\n")
        self.assertEqual(len(shrink.backend_growth("HEAD")), 1)

    def test_every_code_selected_at_the_base_is_ratcheted(self) -> None:
        # E501 is selected through "E"; no hand-kept list has to name it.
        with Path("apps/api/tasks.py").open("a") as f:
            f.write("x = 1  # noqa: E501\n")
        self.assertEqual(len(shrink.backend_growth("HEAD")), 1)

    def test_tests_and_migrations_are_out_of_scope(self) -> None:
        Path("apps/api/app/migrations").mkdir(parents=True)
        Path("apps/api/app/migrations/0001_initial.py").write_text("x = 1  # noqa: E501\n")
        Path("apps/api/tests/test_x.py").write_text("x = 1  # noqa: BLE001\n")
        self.assertEqual(shrink.backend_growth("HEAD"), [])

    def test_an_unreadable_known_violations_fails_loudly(self) -> None:
        Path("apps/api/tests/test_import_boundaries.py").write_text("VIOLATIONS = frozenset()\n")
        with self.assertRaises(ValueError):
            shrink.backend_growth("HEAD")

    def test_a_new_known_violation_fails(self) -> None:
        Path("apps/api/tests/test_import_boundaries.py").write_text(
            "KNOWN_VIOLATIONS = frozenset({('apps.a.x', 'apps.b.views'), ('apps.c.y', 'apps.d.tasks')})\n"
        )
        self.assertEqual(len(shrink.backend_growth("HEAD")), 1)


if __name__ == "__main__":
    unittest.main()
