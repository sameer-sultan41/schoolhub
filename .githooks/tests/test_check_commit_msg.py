"""Tests for .githooks/lib/check_commit_msg.py (ADR-0016), run in CI by repo-hygiene.yml."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / ".githooks" / "lib"))
import check_commit_msg as cm  # its directory is put on sys.path just above


class PassingMessages(unittest.TestCase):
    def assert_passes(self, message: str, *, landing: bool = False) -> None:
        self.assertEqual(cm.problems(message, landing=landing), [], message)

    def test_feature_with_scope(self) -> None:
        self.assert_passes("feat(dashboard): wire the staff screen to real data\n")

    def test_breaking_change_marker(self) -> None:
        self.assert_passes("feat(api)!: drop the v0 envelope\n")

    def test_style_is_allowed(self) -> None:
        # Review Focus 5 of the spec: style commits must pass (this repo uses them).
        self.assert_passes("style(files): wrap an overlong line\n", landing=True)

    def test_every_conventional_type(self) -> None:
        for t in ("feat", "refactor", "test", "docs", "style", "chore", "ci", "perf", "build", "revert"):
            self.assert_passes(f"{t}: something\n", landing=True)

    def test_fix_with_root_cause(self) -> None:
        self.assert_passes("fix(e2e): wait for the drawer\n\nRoot cause: the locator matched two links.\n")

    def test_root_cause_is_case_insensitive(self) -> None:
        self.assert_passes("fix: x\n\nroot cause: y\n")

    def test_git_generated_subjects(self) -> None:
        for subject in ("Merge branch 'main' into feat/x", 'Revert "feat: x"', 'Reapply "feat: x"'):
            self.assert_passes(subject + "\n", landing=True)

    def test_local_only_subjects_pass_while_writing(self) -> None:
        for subject in ("fixup! feat: x", "squash! fix: y", "amend! docs: z"):
            self.assert_passes(subject + "\n")

    def test_diag_passes_while_writing(self) -> None:
        self.assert_passes("diag: log the collapse state\n")

    def test_generated_prose_that_is_not_an_ai_tool(self) -> None:
        # f35edc2's real body line; "generated" is everyday vocabulary here (ADR-0005).
        self.assert_passes("chore: add the lockfile\n\nGenerated with `pnpm install --lockfile-only` (resolution only).\n")

    def test_human_co_author_is_allowed(self) -> None:
        # GitHub's "commit suggestion" button adds the reviewer as co-author.
        self.assert_passes("docs: tidy\n\nCo-authored-by: A Reviewer <reviewer@example.com>\n", landing=True)

    def test_empty_message_is_left_to_git(self) -> None:
        self.assert_passes("\n\n")


class FailingMessages(unittest.TestCase):
    def assert_fails(self, message: str, mentions: str, *, landing: bool = False) -> None:
        issues = cm.problems(message, landing=landing)
        self.assertTrue(issues, f"expected a failure for {message!r}")
        self.assertIn(mentions, " ".join(issues))

    def test_fix_without_root_cause(self) -> None:
        self.assert_fails("fix(api): handle the empty list\n\nIt crashed.\n", "Root cause")

    def test_fix_with_empty_root_cause(self) -> None:
        self.assert_fails("fix: x\n\nRoot cause:\n", "Root cause")

    def test_root_cause_text_must_be_on_the_same_line(self) -> None:
        self.assert_fails("fix: x\n\nRoot cause:\n\nIt crashed.\n", "Root cause")

    def test_root_cause_in_the_subject_does_not_count(self) -> None:
        self.assert_fails("fix: Root cause: typo\n", "Root cause")

    def test_ai_co_author_trailer(self) -> None:
        self.assert_fails("feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n", "Co-authored-by")

    def test_generated_with_an_ai_tool(self) -> None:
        self.assert_fails("feat: x\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n", "Generated with")

    def test_attribution_is_caught_even_on_merge_subjects(self) -> None:
        self.assert_fails("Merge branch 'main'\n\nCo-authored-by: Copilot <c@github.com>\n", "Co-authored-by")

    def test_non_conventional_subject(self) -> None:
        self.assert_fails("Update stuff\n", "subject must be")

    def test_capitalised_type(self) -> None:
        self.assert_fails("Feat: x\n", "subject must be")

    def test_unknown_type(self) -> None:
        self.assert_fails("lint(dashboard): forbid ../ imports\n", "subject must be")

    def test_missing_space_after_colon(self) -> None:
        self.assert_fails("feat:x\n", "subject must be")

    def test_hash_subject_is_checked_in_range_mode(self) -> None:
        # Recorded messages are not comment-stripped: "#42 ..." really is the subject.
        self.assert_fails("#42 hotfix login\n", "subject must be", landing=True)

    def test_fixup_does_not_land(self) -> None:
        self.assert_fails("fixup! feat: x\n", "squash this", landing=True)

    def test_diag_does_not_land(self) -> None:
        self.assert_fails("diag: log the collapse state\n", "diag:", landing=True)


class CommentStripping(unittest.TestCase):
    def test_comment_lines_are_dropped(self) -> None:
        text = cm.strip_comments("docs: tidy\n\n# Please enter the commit message\n# Co-Authored-By: Claude\n")
        self.assertEqual(cm.problems(text), [])

    def test_text_below_scissors_is_dropped(self) -> None:
        text = cm.strip_comments(f"docs: tidy\n\n#{cm.SCISSORS}\n+Generated with Claude\n")
        self.assertEqual(cm.problems(text), [])

    def test_custom_comment_char(self) -> None:
        text = cm.strip_comments("docs: tidy\n; a comment line\n", ";")
        self.assertNotIn("comment line", text)


class RangeMode(unittest.TestCase):
    """--range against a throwaway repo."""

    def setUp(self) -> None:
        self._cwd = os.getcwd()
        self._tmp = tempfile.TemporaryDirectory()
        os.chdir(self._tmp.name)
        self._git("init", "-q", "-b", "main")
        self._commit("docs: base", "a")

    def tearDown(self) -> None:
        os.chdir(self._cwd)
        self._tmp.cleanup()

    def _git(self, *args: str) -> None:
        subprocess.run(
            ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", *args], check=True, capture_output=True
        )

    def _commit(self, message: str, content: str, name: str = "f.txt") -> None:
        Path(name).write_text(content, encoding="utf-8")
        self._git("add", "-A")
        self._git("commit", "-q", "-m", message)

    def test_clean_range_passes(self) -> None:
        self._commit("feat: one", "b")
        self._commit("fix: two\n\nRoot cause: three", "c")
        self.assertEqual(cm.main(["x", "--range", "HEAD~2..HEAD"]), 0)

    def test_one_bad_commit_fails_the_range(self) -> None:
        self._commit("feat: one", "b")
        self._commit("fix: no cause given", "c")
        self.assertEqual(cm.main(["x", "--range", "HEAD~2..HEAD"]), 1)

    def test_merge_commits_are_skipped(self) -> None:
        self._git("checkout", "-q", "-b", "topic")
        self._commit("feat: on topic", "t", "topic.txt")
        self._git("checkout", "-q", "main")
        self._commit("docs: on main", "m", "main.txt")
        # A merge commit whose message breaks every rule must not be checked (--no-merges).
        self._git("merge", "-q", "--no-ff", "topic", "-m", "not a conventional subject at all")
        self.assertEqual(cm.main(["x", "--range", "HEAD~1..HEAD"]), 0)


class HookScript(unittest.TestCase):
    """The installed hook itself: exit codes on a real message file."""

    HOOK = REPO / ".githooks" / "commit-msg"

    def run_hook(self, message: str) -> int:
        with tempfile.NamedTemporaryFile("w", delete=False, suffix=".txt") as f:
            f.write(message)
        try:
            env = {**os.environ, "SKIP_HOOKS": "0"}
            return subprocess.run(
                ["bash", str(self.HOOK), f.name], cwd=REPO, env=env, capture_output=True, check=False
            ).returncode
        finally:
            os.unlink(f.name)

    def test_hook_accepts_a_good_message(self) -> None:
        self.assertEqual(self.run_hook("docs: fine\n"), 0)

    def test_hook_rejects_an_ai_trailer(self) -> None:
        self.assertEqual(self.run_hook("feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n"), 1)


if __name__ == "__main__":
    unittest.main()
