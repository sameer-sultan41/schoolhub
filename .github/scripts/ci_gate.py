#!/usr/bin/env python3
"""Deploy gate: is CI green for this SHA?

    ci_gate.py [--repo <owner/repo>] --sha <sha> [--wait-minutes 45] [--poll-seconds 30]
               [--exclude <workflow name>]...

The CI workflows are path-filtered, so which of them run differs per commit; a
`workflow_run` trigger cannot express "everything that ran is green". This script
lists the push runs for the SHA, keeps the newest run per workflow, drops the
excluded ones (`deploy` itself and the `terraform-plan` drift plan by default), and
decides. deploy.yml runs it before it builds or deploys; the schoolhub-deploy skill
runs it with `--wait-minutes 0` for its CI-green precondition.

Exit codes: 0 green, 1 red (or still pending at the deadline), 3 superseded
(a run was cancelled). Writes `verdict=<green|red|superseded>` to $GITHUB_OUTPUT.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from typing import Literal

Verdict = Literal["pending", "green", "red", "superseded"]

DEFAULT_EXCLUDE = ("deploy", "terraform-plan")
NO_RUNS_GRACE_SECONDS = 120
RED = {"failure", "timed_out", "startup_failure", "action_required"}
GREEN = {"success", "skipped", "neutral"}


def newest_per_workflow(runs: list[dict]) -> list[dict]:
    newest: dict[object, dict] = {}
    for run in runs:
        key = run.get("workflow_id", run.get("name"))
        current = newest.get(key)
        rank = (run.get("created_at") or "", run.get("run_attempt") or 0, run.get("id") or 0)
        if current is None or rank > (
            current.get("created_at") or "", current.get("run_attempt") or 0, current.get("id") or 0
        ):
            newest[key] = run
    return list(newest.values())


def decide(runs: list[dict], exclude: set[str], waited_seconds: int) -> tuple[Verdict, str]:
    """The gate's verdict for the push runs of one SHA, and a one-line reason."""
    considered = [r for r in newest_per_workflow(runs) if r.get("name") not in exclude]
    if not considered:
        if waited_seconds < NO_RUNS_GRACE_SECONDS:
            return "pending", "no CI runs yet"
        return "red", "no CI runs for this SHA: it was never pushed to main"
    running = [r["name"] for r in considered if r.get("status") != "completed"]
    if running:
        return "pending", "still running: " + ", ".join(sorted(running))
    failed = [r["name"] for r in considered if r.get("conclusion") in RED]
    if failed:
        return "red", "failed: " + ", ".join(sorted(failed))
    cancelled = [r["name"] for r in considered if r.get("conclusion") == "cancelled"]
    if cancelled:
        return "superseded", "cancelled: " + ", ".join(sorted(cancelled))
    other = [r["name"] for r in considered if r.get("conclusion") not in GREEN]
    if other:
        return "red", "unexpected conclusion: " + ", ".join(sorted(other))
    return "green", "green: " + ", ".join(sorted(r["name"] for r in considered))


def default_repo() -> str:
    repo = os.environ.get("GITHUB_REPOSITORY")
    if repo:
        return repo
    return subprocess.run(
        ["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
        check=True, capture_output=True, text=True,
    ).stdout.strip()


def list_runs(repo: str, sha: str) -> list[dict]:
    out = subprocess.run(
        [
            "gh", "api", "--paginate",
            f"repos/{repo}/actions/runs?head_sha={sha}&event=push&per_page=100",
            "--jq", ".workflow_runs[] | @json",
        ],
        check=True, capture_output=True, text=True,
    ).stdout
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def write_output(verdict: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(f"verdict={verdict}\n")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo")
    parser.add_argument("--sha", required=True)
    parser.add_argument("--wait-minutes", type=int, default=45)
    parser.add_argument("--poll-seconds", type=int, default=30)
    parser.add_argument("--exclude", action="append")
    args = parser.parse_args(argv[1:])
    exclude = set(args.exclude if args.exclude is not None else DEFAULT_EXCLUDE)
    repo = args.repo or default_repo()

    deadline = args.wait_minutes * 60
    waited = 0
    while True:
        verdict, reason = decide(list_runs(repo, args.sha), exclude, waited)
        if verdict != "pending" or waited >= deadline:
            break
        print(f"pending ({waited // 60} min): {reason}", flush=True)
        time.sleep(args.poll_seconds)
        waited += args.poll_seconds

    if verdict == "pending":
        verdict, reason = "red", f"still pending after {args.wait_minutes} min: {reason}"
    write_output(verdict)
    if verdict == "green":
        print(f"CI gate: {reason}")
        return 0
    if verdict == "superseded":
        print(f"::notice::CI gate: {reason}; this SHA is not shipped")
        return 3
    print(f"::error::CI gate: {reason}")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
