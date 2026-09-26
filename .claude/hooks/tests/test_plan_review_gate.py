"""Tests for .claude/hooks/plan_review_gate.py, run in CI by repo-hygiene.yml.

They execute the EXACT command string registered in .claude/settings.json through a shell,
with CLAUDE_PROJECT_DIR set and the working directory inside a subdirectory — so a broken
path, a wrong quote or a missing `|| true` fails here, not in someone's session.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]


def _gate_command() -> str:
    settings = json.loads((REPO / ".claude" / "settings.json").read_text(encoding="utf-8"))
    for entry in settings["hooks"]["PreToolUse"]:
        if entry.get("matcher") == "ExitPlanMode":
            return entry["hooks"][0]["command"]
    raise AssertionError("no ExitPlanMode PreToolUse hook registered in .claude/settings.json")


COMMAND = _gate_command()


def run_gate(stdin: str, project_dir: Path = REPO) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(project_dir)}
    return subprocess.run(
        COMMAND,
        shell=True,
        input=stdin,
        capture_output=True,
        text=True,
        cwd=REPO / "apps" / "api",  # hooks can fire with any cwd; never assume the repo root
        env=env,
        timeout=30,
        check=False,
    )


def payload(plan: str | None = None, plan_file: str | None = None, tool: str = "ExitPlanMode") -> str:
    tool_input: dict[str, str] = {}
    if plan is not None:
        tool_input["plan"] = plan
    if plan_file is not None:
        tool_input["planFilePath"] = plan_file
    return json.dumps({"hook_event_name": "PreToolUse", "tool_name": tool, "tool_input": tool_input})


class GateTestCase(unittest.TestCase):
    def assert_allowed(self, result: subprocess.CompletedProcess[str]) -> None:
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "", "an allowed call must print no decision")

    def assert_denied(self, result: subprocess.CompletedProcess[str], mentions: str) -> None:
        self.assertEqual(result.returncode, 0, result.stderr)
        out = json.loads(result.stdout)["hookSpecificOutput"]
        self.assertEqual(out["hookEventName"], "PreToolUse")
        self.assertEqual(out["permissionDecision"], "deny")
        self.assertIn(mentions, out["permissionDecisionReason"])


class AllowsTests(GateTestCase):
    def test_tier_0(self) -> None:
        self.assert_allowed(run_gate(payload("# Fix typo\n\n**Work tier:** 0\n\nChange one word.")))

    def test_tier_1(self) -> None:
        self.assert_allowed(run_gate(payload("# Small change\n\n**Work tier:** 1\n")))

    def test_review_waived_by_user(self) -> None:
        self.assert_allowed(run_gate(payload("# Plan\n\n**Work tier:** 2\n**Review:** waived by user\n")))

    def test_reviewed_approve(self) -> None:
        plan = "# Plan\n\n**Work tier:** 2\n\n## Independent review\n\nVerdict: APPROVE\n"
        self.assert_allowed(run_gate(payload(plan)))

    def test_reviewed_revise_in_bold_bullet(self) -> None:
        plan = "# Plan\n\n**Work tier:** 2\n\n## Independent review\n\n- **Verdict:** REVISE — all addressed\n"
        self.assert_allowed(run_gate(payload(plan)))

    def test_other_tools_pass_through(self) -> None:
        self.assert_allowed(run_gate(payload("# Plan\n**Work tier:** 2\n", tool="Bash")))

    def test_plan_read_from_plan_file_path(self) -> None:
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
            f.write("# Plan\n\n**Work tier:** 2\n\n## Independent review\n\nVerdict: APPROVE\n")
        try:
            self.assert_allowed(run_gate(payload(plan_file=f.name)))
        finally:
            os.unlink(f.name)


class DeniesTests(GateTestCase):
    def test_tier_2_unreviewed(self) -> None:
        self.assert_denied(run_gate(payload("# Plan\n\n**Work tier:** 2\n\nDo many things.")), "plan-reviewer")

    def test_missing_tier_line_is_treated_as_tier_2(self) -> None:
        self.assert_denied(run_gate(payload("# Plan\n\nNo tier stated.")), "plan-reviewer")

    def test_review_heading_without_verdict(self) -> None:
        plan = "# Plan\n\n**Work tier:** 2\n\n## Independent review\n\nTo do.\n"
        self.assert_denied(run_gate(payload(plan)), "plan-reviewer")

    def test_verdict_outside_the_review_section_does_not_count(self) -> None:
        plan = "# Plan\n\n**Work tier:** 2\n\n## Notes\n\nVerdict: APPROVE (from an old plan)\n"
        self.assert_denied(run_gate(payload(plan)), "plan-reviewer")

    def test_verdict_in_a_later_section_does_not_count(self) -> None:
        plan = "**Work tier:** 2\n\n## Independent review\n\nPending.\n\n## Appendix\n\nVerdict: APPROVE\n"
        self.assert_denied(run_gate(payload(plan)), "plan-reviewer")

    def test_rethink_verdict(self) -> None:
        plan = "# Plan\n\n**Work tier:** 2\n\n## Independent review\n\nVerdict: RETHINK\n"
        self.assert_denied(run_gate(payload(plan)), "RETHINK")

    def test_unreviewed_plan_from_plan_file_path(self) -> None:
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
            f.write("# Plan\n\n**Work tier:** 2\n")
        try:
            self.assert_denied(run_gate(payload(plan_file=f.name)), "plan-reviewer")
        finally:
            os.unlink(f.name)


class FailsOpenTests(GateTestCase):
    def test_malformed_json(self) -> None:
        result = run_gate("{not json")
        self.assert_allowed(result)
        self.assertIn("plan_review_gate", result.stderr)

    def test_payload_without_a_plan(self) -> None:
        self.assert_allowed(run_gate(payload()))

    def test_plan_file_that_does_not_exist(self) -> None:
        self.assert_allowed(run_gate(payload(plan_file="/nonexistent/plan.md")))

    def test_script_missing_entirely(self) -> None:
        # CLAUDE_PROJECT_DIR pointing somewhere without the script: python exits 2 ("can't
        # open file"), which Claude Code would treat as BLOCK — the `|| true` must absorb it.
        with tempfile.TemporaryDirectory() as empty:
            result = run_gate(payload("# Plan\n**Work tier:** 2\n"), project_dir=Path(empty))
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "")


class HardeningTests(GateTestCase):
    def test_verdict_template_inside_a_code_fence_does_not_count(self) -> None:
        plan = "**Work tier:** 2\n\n## Independent review\n\n```\nVerdict: APPROVE | REVISE | RETHINK\n```\n"
        self.assert_denied(run_gate(payload(plan)), "plan-reviewer")

    def test_tier_line_inside_a_code_fence_does_not_count(self) -> None:
        plan = "# Plan\n\n```md\n**Work tier:** 0\n```\n\nReal work, no tier stated.\n"
        self.assert_denied(run_gate(payload(plan)), "plan-reviewer")

    def test_last_verdict_wins_rethink_after_approve(self) -> None:
        plan = "**Work tier:** 2\n\n## Independent review\n\nRound 1 Verdict: APPROVE\n\nRound 2 Verdict: RETHINK\n"
        self.assert_denied(run_gate(payload(plan)), "RETHINK")

    def test_last_verdict_wins_approve_after_rethink(self) -> None:
        plan = "**Work tier:** 2\n\n## Independent review\n\nRound 1 Verdict: RETHINK\n\nRound 2 Verdict: APPROVE\n"
        self.assert_allowed(run_gate(payload(plan)))

    def test_an_h1_ends_the_review_section(self) -> None:
        plan = "**Work tier:** 2\n\n## Independent review\n\nPending.\n\n# Appendix\n\nVerdict: APPROVE\n"
        self.assert_denied(run_gate(payload(plan)), "plan-reviewer")

    def test_build_order_tier_heading_is_not_an_exemption(self) -> None:
        # project-status uses "Tier 0 — Foundation" for module build order; that must not
        # read as work tier 0.
        plan = "# Tenancy hardening\n\n**Tier:** 0 — Foundation\n\nRework RLS binding.\n"
        self.assert_denied(run_gate(payload(plan)), "plan-reviewer")

    def test_appended_second_review_block_rethink_wins(self) -> None:
        plan = (
            "**Work tier:** 2\n\n## Independent review\n\nVerdict: APPROVE\n\n"
            "## Amendment\n\nChanged scope.\n\n## Independent review\n\nVerdict: RETHINK\n"
        )
        self.assert_denied(run_gate(payload(plan)), "RETHINK")

    def test_appended_second_review_block_approve_wins(self) -> None:
        plan = (
            "**Work tier:** 2\n\n## Independent review\n\nVerdict: RETHINK\n\n"
            "## Independent review\n\nVerdict: APPROVE\n"
        )
        self.assert_allowed(run_gate(payload(plan)))

    def test_tier_line_in_a_bullet_counts(self) -> None:
        self.assert_allowed(run_gate(payload("# Plan\n\n- **Work tier:** 1\n- **Owner:** me\n")))

    def test_double_digit_tier_is_not_tier_1(self) -> None:
        self.assert_denied(run_gate(payload("**Work tier:** 10\n")), "plan-reviewer")


class DirectInvocationTests(unittest.TestCase):
    """Without the settings command's `|| true`, so the script's own fail-open is what's tested."""

    SCRIPT = REPO / ".claude" / "hooks" / "plan_review_gate.py"

    def test_script_itself_exits_zero_and_warns_on_bad_input(self) -> None:
        result = subprocess.run(
            [sys.executable, str(self.SCRIPT)], input="{not json", capture_output=True, text=True, timeout=30, check=False
        )
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "")
        self.assertIn("allowing ExitPlanMode", result.stderr)


class ReviewRecordDateTests(unittest.TestCase):
    """The CI checker's grandfathering rule (check_review_records.needs_review)."""

    @classmethod
    def setUpClass(cls) -> None:
        sys.path.insert(0, str(REPO / ".claude" / "hooks"))
        from check_review_records import needs_review

        cls.needs_review = staticmethod(needs_review)

    def test_files_dated_from_adoption_need_review(self) -> None:
        self.assertTrue(self.needs_review("docs/superpowers/specs/2026-09-26-some-design.md"))
        self.assertTrue(self.needs_review("docs/superpowers/plans/2027-01-02-later.md"))

    def test_only_files_dated_before_adoption_are_grandfathered(self) -> None:
        self.assertFalse(self.needs_review("docs/superpowers/plans/2026-09-24-staff-photo-urls.md"))

    def test_undated_files_need_review(self) -> None:
        self.assertTrue(self.needs_review("docs/superpowers/plans/staff-refactor.md"))


class ReviewRecordEndToEndTests(unittest.TestCase):
    """check_review_records.main() against a real throwaway git repo: pathspecs, diff filter, exit code."""

    @classmethod
    def setUpClass(cls) -> None:
        sys.path.insert(0, str(REPO / ".claude" / "hooks"))
        import check_review_records

        cls.checker = check_review_records

    def setUp(self) -> None:
        self._cwd = os.getcwd()
        self._tmp = tempfile.TemporaryDirectory()
        os.chdir(self._tmp.name)
        self._git("init", "-q")
        Path("README.md").write_text("base\n", encoding="utf-8")
        self._commit("base")

    def tearDown(self) -> None:
        os.chdir(self._cwd)
        self._tmp.cleanup()

    def _git(self, *args: str) -> None:
        subprocess.run(
            ["git", "-c", "user.name=test", "-c", "user.email=test@example.invalid", *args],
            check=True,
            capture_output=True,
        )

    def _commit(self, message: str) -> None:
        self._git("add", "-A")
        self._git("commit", "-q", "-m", message)

    def _add_spec(self, name: str, body: str) -> None:
        path = Path("docs/superpowers/specs") / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")
        self._commit(f"add {name}")

    def test_unreviewed_new_spec_fails(self) -> None:
        self._add_spec("2026-09-27-design.md", "# Design\n\n**Work tier:** 2\n")
        self.assertEqual(self.checker.main(["check", "HEAD~1"]), 1)

    def test_reviewed_new_spec_passes(self) -> None:
        self._add_spec("2026-09-27-design.md", "**Work tier:** 2\n\n## Independent review\n\n- **Verdict:** REVISE\n")
        self.assertEqual(self.checker.main(["check", "HEAD~1"]), 0)

    def test_old_dated_spec_is_grandfathered(self) -> None:
        self._add_spec("2026-09-20-old.md", "# Old design, no review\n")
        self.assertEqual(self.checker.main(["check", "HEAD~1"]), 0)

    def test_undated_new_spec_fails(self) -> None:
        self._add_spec("design-without-date.md", "# Design\n")
        self.assertEqual(self.checker.main(["check", "HEAD~1"]), 1)

    def test_bad_base_ref_fails_loudly(self) -> None:
        with self.assertRaises(subprocess.CalledProcessError):
            self.checker.main(["check", "no-such-ref"])


if __name__ == "__main__":
    unittest.main()
