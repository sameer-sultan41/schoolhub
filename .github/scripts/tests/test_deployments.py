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


def dep(i: int, sha: str, task: str = "deploy", record_sha: str | None = None, **payload: object) -> dict:
    return {
        "id": i, "task": task, "sha": record_sha or sha, "created_at": f"2026-11-{10 + i:02d}T00:00:00Z",
        "payload": {"target_sha": sha, **payload}, "creator": {"login": "u"},
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
        api = FakeApi([listing, dp.ApiResult(0, json.dumps(st("success")[0]), "")])
        code, out = run_main(["deployments.py", "--repo", "o/r", "current", "--env", "staging"], api)
        self.assertEqual((code, out.strip()), (0, A))


if __name__ == "__main__":
    unittest.main()
