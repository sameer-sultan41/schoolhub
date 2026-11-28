"""Tests for .github/scripts/ci_gate.py, run by repo-hygiene.yml (deploy-scripts)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / ".github" / "scripts"))
import ci_gate  # its directory is put on sys.path just above

DEFAULT = set(ci_gate.DEFAULT_EXCLUDE)


def run(name: str, status: str = "completed", conclusion: str | None = "success",
        created: str = "2026-11-28T10:00:00Z", wf: int | None = None, rid: int = 1) -> dict:
    return {
        "id": rid, "name": name, "workflow_id": wf if wf is not None else hash(name),
        "status": status, "conclusion": conclusion, "created_at": created, "run_attempt": 1,
    }


class DecideTests(unittest.TestCase):
    def verdict(self, runs: list[dict], waited: int = 0, exclude: set[str] = DEFAULT) -> str:
        return ci_gate.decide(runs, exclude, waited)[0]

    def test_no_runs_inside_grace_is_pending(self) -> None:
        self.assertEqual(self.verdict([], waited=60), "pending")

    def test_no_runs_after_grace_is_red(self) -> None:
        self.assertEqual(self.verdict([], waited=120), "red")

    def test_a_running_workflow_is_pending(self) -> None:
        self.assertEqual(
            self.verdict([run("api"), run("repo-hygiene", status="in_progress", conclusion=None)]),
            "pending",
        )

    def test_each_failure_conclusion_is_red(self) -> None:
        for conclusion in ("failure", "timed_out", "startup_failure", "action_required"):
            with self.subTest(conclusion):
                self.assertEqual(self.verdict([run("api", conclusion=conclusion)]), "red")

    def test_cancelled_is_superseded(self) -> None:
        self.assertEqual(self.verdict([run("api", conclusion="cancelled")]), "superseded")

    def test_success_skipped_and_neutral_are_green(self) -> None:
        runs = [run("api"), run("frontend", conclusion="skipped"), run("repo-hygiene", conclusion="neutral")]
        self.assertEqual(self.verdict(runs), "green")

    def test_newest_run_per_workflow_wins(self) -> None:
        runs = [
            run("api", conclusion="failure", created="2026-11-28T10:00:00Z", wf=7, rid=1),
            run("api", conclusion="success", created="2026-11-28T11:00:00Z", wf=7, rid=2),
        ]
        self.assertEqual(self.verdict(runs), "green")

    def test_excluded_workflow_failure_is_ignored(self) -> None:
        runs = [run("api"), run("ai-evals", conclusion="failure")]
        self.assertEqual(self.verdict(runs, exclude={"ai-evals"}), "green")

    def test_failed_terraform_plan_push_run_is_ignored_by_default(self) -> None:
        runs = [run("repo-hygiene"), run("terraform-plan", conclusion="failure")]
        self.assertEqual(self.verdict(runs), "green")

    def test_deploy_itself_in_progress_is_ignored_by_default(self) -> None:
        runs = [run("repo-hygiene"), run("deploy", status="in_progress", conclusion=None)]
        self.assertEqual(self.verdict(runs), "green")


if __name__ == "__main__":
    unittest.main()
