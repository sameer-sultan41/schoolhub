"""Tests for .github/scripts/deployments.py, run by repo-hygiene.yml (deploy-scripts)."""

from __future__ import annotations

import contextlib
import io
import json
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / ".github" / "scripts"))
import deployments as dp  # its directory is put on sys.path just above

A, B, C = "a" * 40, "b" * 40, "c" * 40


def dep(i: int, sha: str, task: str = "deploy", record_sha: str | None = None,
        creator: str = dp.BOT_LOGIN, **payload: object) -> dict:
    return {
        "id": i, "task": task, "sha": record_sha or sha, "environment": "staging",
        "created_at": f"2026-11-{10 + i:02d}T00:00:00Z", "creator": {"login": creator},
        "payload": {"target_sha": sha, "mode": "deploy", "run_id": str(900 + i), "run_attempt": "1", **payload},
    }


def deploy_run(i: int, sha: str = A, path: str = ".github/workflows/deploy.yml", branch: str = "main",
               event: str = "push", title: str | None = None, attempts: int = 1) -> dict:
    """The deploy.yml run that created dep(i, sha): live across the record's created_at."""
    day = 10 + i
    return {
        "id": 900 + i, "path": path, "head_branch": branch, "event": event, "run_attempt": attempts,
        # deploy.yml's run-name: deploy <environment> <sha> (<mode>)
        "display_title": title or f"deploy staging {sha} (deploy)",
        "created_at": f"2026-11-{day:02d}T00:00:00Z", "updated_at": f"2026-11-{day:02d}T01:00:00Z",
    }


def st(*states: str) -> list[dict]:
    return [{"id": n, "state": s, "created_at": f"2026-11-28T00:00:{n:02d}Z"} for n, s in enumerate(states)]


class PureCoreTests(unittest.TestCase):
    def test_record_sha_differing_from_payload_is_read_by_payload(self) -> None:
        d = dep(1, A, record_sha=B)
        self.assertEqual(dp.pick_current([d], {1: st("success")}), A)

    def test_newest_success_wins(self) -> None:
        deps = [dep(1, A), dep(2, B)]
        self.assertEqual(dp.pick_current(deps, {1: st("success"), 2: st("success")}), B)

    def test_newer_failure_does_not_replace_current_success(self) -> None:
        deps = [dep(1, A), dep(2, B)]
        self.assertEqual(dp.pick_current(deps, {1: st("success"), 2: st("in_progress", "failure")}), A)

    def test_success_then_inactive_is_not_current_but_ever_succeeded(self) -> None:
        deps = [dep(1, A)]
        statuses = {1: st("in_progress", "success", "inactive")}
        self.assertIsNone(dp.pick_current(deps, statuses))
        self.assertTrue(dp.ever_succeeded(statuses[1]))

    def test_record_from_another_creator_is_ignored(self) -> None:
        self.assertIsNone(dp.pick_current([dep(1, A, creator="mallory")], {1: st("success")}))

    def test_run_from_another_workflow_does_not_match(self) -> None:
        self.assertFalse(dp.run_matches(dep(1, A), deploy_run(1, path=".github/workflows/evil.yml")))

    def test_run_from_another_branch_does_not_match(self) -> None:
        self.assertFalse(dp.run_matches(dep(1, A), deploy_run(1, branch="feature")))

    def test_record_created_outside_the_run_does_not_match(self) -> None:
        self.assertFalse(dp.run_matches(dep(1, A), deploy_run(2)))

    def test_record_created_after_the_run_ended_does_not_match(self) -> None:
        run = deploy_run(1) | {"created_at": "2026-11-10T00:00:00Z", "updated_at": "2026-11-10T01:00:00Z"}
        self.assertFalse(dp.run_matches(dep(1, A), run))

    def test_run_from_another_event_does_not_match(self) -> None:
        self.assertFalse(dp.run_matches(dep(1, A), deploy_run(1, event="pull_request")))

    def test_run_for_another_sha_does_not_match(self) -> None:
        self.assertFalse(dp.run_matches(dep(1, A), deploy_run(1, sha=B)))

    def test_run_for_another_mode_does_not_match(self) -> None:
        self.assertFalse(dp.run_matches(dep(1, A), deploy_run(1, title=f"deploy staging {A} (rollback)")))

    def test_run_for_another_environment_does_not_match(self) -> None:
        self.assertFalse(dp.run_matches(dep(1, A), deploy_run(1, title=f"deploy production {A} (deploy)")))

    def test_attempt_beyond_the_runs_attempts_does_not_match(self) -> None:
        self.assertFalse(dp.run_matches(dep(1, A, run_attempt="2"), deploy_run(1)))
        self.assertTrue(dp.run_matches(dep(1, A, run_attempt="2"), deploy_run(1, attempts=2)))

    def test_records_sharing_a_run_attempt_are_all_dropped(self) -> None:
        real, forged = dep(1, A), dep(2, A, run_id="901")
        self.assertEqual(dp.unique_runs([real, forged]), [])

    def test_records_of_different_attempts_of_one_run_are_kept(self) -> None:
        first, rerun = dep(1, A), dep(2, A, run_id="901", run_attempt="2")
        self.assertEqual(dp.unique_runs([first, rerun]), [first, rerun])

    def test_deploy_run_on_main_matches(self) -> None:
        self.assertTrue(dp.run_matches(dep(1, A), deploy_run(1, event="workflow_dispatch")))

    def test_other_task_is_ignored(self) -> None:
        self.assertIsNone(dp.pick_current([dep(1, A, task="deploy:other")], {1: st("success")}))

    def test_no_deployments_is_none(self) -> None:
        self.assertIsNone(dp.pick_current([], {}))

    def test_overrides_between_finds_override_inside_range_only(self) -> None:
        deps = [
            dep(1, A),
            dep(2, B, contract_override=True),
            dep(3, C),
            dep(4, "d" * 40, contract_override=True),
        ]
        statuses = {i: st("success") for i in range(1, 5)}
        found = dp.overrides_between(deps, statuses, A, C)
        self.assertEqual([dp.target_sha(d) for d in found], [B])


class FakeApi:
    def __init__(self, responses: list[dp.ApiResult]) -> None:
        self.responses = responses
        self.calls: list[tuple[list[str], dict | None]] = []

    def __call__(self, args: list[str], body: dict | None) -> dp.ApiResult:
        self.calls.append((args, body))
        return self.responses.pop(0)


POLICY_422 = dp.ApiResult(
    1, '{"message":"Branch \\"x\\" is not allowed to deploy to production due to environment protection rules."}',
    "gh: Branch is not allowed to deploy (HTTP 422)",
)
OTHER_422 = dp.ApiResult(1, '{"message":"Validation Failed"}', "gh: Validation Failed (HTTP 422)")
CREATED = dp.ApiResult(0, '{"id": 42}', "")
OK = dp.ApiResult(0, "{}", "")

CREATE_ARGS = [
    "deployments.py", "--repo", "o/r", "create", "--env", "production", "--sha", A, "--mode", "deploy",
    "--previous", B, "--allow-contract", "true", "--allow-unstaged", "false", "--ack-review", "true",
    "--contract-override", "true",
]


def run_main(argv: list[str], api: FakeApi) -> tuple[int, str]:
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
        code = dp.main(argv, api)
    return code, out.getvalue()


class CreateTests(unittest.TestCase):
    def test_branch_policy_422_retries_with_ref_main_and_keeps_target_sha(self) -> None:
        api = FakeApi([POLICY_422, CREATED, OK])
        code, out = run_main(CREATE_ARGS, api)
        self.assertEqual((code, out.strip()), (0, "42"))
        retry = api.calls[1][1]
        assert retry is not None
        self.assertEqual(retry["ref"], "main")
        self.assertEqual(retry["payload"]["target_sha"], A)

    def test_other_422_is_not_retried(self) -> None:
        api = FakeApi([OTHER_422])
        code, _ = run_main(CREATE_ARGS, api)
        self.assertEqual(code, 2)
        self.assertEqual(len(api.calls), 1)

    def test_create_sends_every_override_field(self) -> None:
        api = FakeApi([CREATED, OK])
        run_main(CREATE_ARGS, api)
        body = api.calls[0][1]
        assert body is not None
        self.assertEqual(body["ref"], A)
        self.assertEqual(body["task"], "deploy")
        self.assertEqual(body["required_contexts"], [])
        payload = body["payload"]
        self.assertEqual(
            {k: payload[k] for k in ("allow_contract_migration", "allow_unstaged_sha",
                                     "acknowledge_migration_review", "contract_override")},
            {"allow_contract_migration": True, "allow_unstaged_sha": False,
             "acknowledge_migration_review": True, "contract_override": True},
        )
        status = api.calls[1][1]
        assert status is not None
        self.assertEqual(status["state"], "in_progress")

    def test_current_reads_through_the_api(self) -> None:
        listing = dp.ApiResult(0, json.dumps(dep(1, A)) + "\n" + json.dumps(dep(2, B, task="other")), "")
        api = FakeApi([
            listing,
            dp.ApiResult(0, json.dumps(deploy_run(1)), ""),
            dp.ApiResult(0, json.dumps(st("success")[0]), ""),
        ])
        code, out = run_main(["deployments.py", "--repo", "o/r", "current", "--env", "staging"], api)
        self.assertEqual((code, out.strip()), (0, A))

    def test_forged_record_pointing_at_a_branch_run_is_not_current(self) -> None:
        listing = dp.ApiResult(0, json.dumps(dep(1, A)) + "\n" + json.dumps(dep(2, B)), "")
        api = FakeApi([
            listing,
            dp.ApiResult(0, json.dumps(deploy_run(1)), ""),
            dp.ApiResult(0, json.dumps(deploy_run(2, sha=B, branch="feature")), ""),
            dp.ApiResult(0, json.dumps(st("success")[0]), ""),
        ])
        code, out = run_main(["deployments.py", "--repo", "o/r", "current", "--env", "staging"], api)
        self.assertEqual((code, out.strip()), (0, A))

    def test_each_run_is_fetched_once(self) -> None:
        second = dep(2, B, run_id="901", run_attempt="2")
        listing = dp.ApiResult(0, json.dumps(dep(1, A)) + "\n" + json.dumps(second), "")
        run = dp.ApiResult(0, json.dumps(deploy_run(1, attempts=2) | {"updated_at": "2026-11-13T00:00:00Z"}), "")
        ok = dp.ApiResult(0, json.dumps(st("success")[0]), "")
        api = FakeApi([listing, run, ok, ok])
        run_main(["deployments.py", "--repo", "o/r", "current", "--env", "staging"], api)
        self.assertEqual(sum(1 for args, _ in api.calls if "actions/runs/901" in args[-1]), 1)


if __name__ == "__main__":
    unittest.main()
