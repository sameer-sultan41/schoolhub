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


if __name__ == "__main__":
    unittest.main()
