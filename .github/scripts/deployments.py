#!/usr/bin/env python3
"""GitHub Deployments API: what is deployed where (D10).

    deployments.py current           --env <env>
    deployments.py ever-succeeded    --env <env> --sha <sha>
    deployments.py overrides-between --env <env> --from <sha> --to <sha>
    deployments.py create            --env <env> --sha <sha> --mode <deploy|rollback> --previous <sha|''>
                                     --allow-contract <bool> --allow-unstaged <bool> --ack-review <bool>
                                     --contract-override <bool>
    deployments.py status            --id <id> --state <in_progress|success|failure|error>
                                     [--description <s>] [--environment-url <url>]
    deployments.py show              --env <env> --sha <sha>
    deployments.py history           --env <env>
    common: [--repo <owner/repo>]

deploy.yml, deploy-env.yml and the schoolhub-deploy skill all read "currently deployed"
through this one script. Every record carries `task: deploy` and the deployed SHA in
`payload.target_sha`; every reader filters on the task and reads the payload, never the
record's `sha` (which is `main`'s head when `create` falls back to `ref: main`).
Stdlib only; calls `gh api`.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass

TASK = "deploy"
BRANCH_POLICY_MARKERS = ("protection rules", "not allowed to deploy")


@dataclass(frozen=True)
class ApiResult:
    code: int
    stdout: str
    stderr: str


Api = Callable[[list[str], dict | None], ApiResult]


def gh_api(args: list[str], body: dict | None = None) -> ApiResult:
    cmd = ["gh", "api", *args]
    if body is not None:
        cmd += ["--input", "-"]
    proc = subprocess.run(
        cmd, input=json.dumps(body) if body is not None else None, capture_output=True, text=True
    )
    return ApiResult(proc.returncode, proc.stdout, proc.stderr)


class ApiError(RuntimeError):
    pass


def _lines(result: ApiResult) -> list[dict]:
    if result.code != 0:
        raise ApiError(result.stderr.strip() or result.stdout.strip())
    return [json.loads(line) for line in result.stdout.splitlines() if line.strip()]


# --- pure core ---------------------------------------------------------------------


def target_sha(deployment: dict) -> str | None:
    payload = deployment.get("payload")
    if isinstance(payload, str):
        try:
            payload = json.loads(payload) if payload else {}
        except json.JSONDecodeError:
            return None
    if isinstance(payload, dict):
        sha = payload.get("target_sha")
        return sha if isinstance(sha, str) and sha else None
    return None


def _payload(deployment: dict) -> dict:
    payload = deployment.get("payload")
    if isinstance(payload, str):
        try:
            payload = json.loads(payload) if payload else {}
        except json.JSONDecodeError:
            return {}
    return payload if isinstance(payload, dict) else {}


def _order(item: dict) -> tuple[str, int]:
    return (item.get("created_at") or "", item.get("id") or 0)


def ours(deployments: list[dict]) -> list[dict]:
    """Only records this pipeline made: task=deploy with a target SHA, oldest first."""
    return sorted(
        (d for d in deployments if d.get("task") == TASK and target_sha(d)), key=_order
    )


def latest_state(statuses: list[dict]) -> str | None:
    if not statuses:
        return None
    return max(statuses, key=_order).get("state")


def ever_succeeded(statuses: list[dict]) -> bool:
    return any(s.get("state") == "success" for s in statuses)


def pick_current(deployments: list[dict], statuses: dict[int, list[dict]]) -> str | None:
    """The target SHA of the newest deployment whose latest status is success."""
    for d in reversed(ours(deployments)):
        if latest_state(statuses.get(d["id"], [])) == "success":
            return target_sha(d)
    return None


def successful(deployments: list[dict], statuses: dict[int, list[dict]]) -> list[dict]:
    """Deployments that ever succeeded, oldest first."""
    return [d for d in ours(deployments) if ever_succeeded(statuses.get(d["id"], []))]


def overrides_between(
    deployments: list[dict], statuses: dict[int, list[dict]], from_sha: str, to_sha: str
) -> list[dict]:
    """Successful deployments after from_sha's latest success, up to and including to_sha's,
    whose payload has contract_override."""
    done = successful(deployments, statuses)
    shas = [target_sha(d) for d in done]
    start = max((i for i, s in enumerate(shas) if s == from_sha), default=-1) + 1
    end = max((i for i, s in enumerate(shas) if s == to_sha), default=len(done) - 1)
    return [d for d in done[start : end + 1] if _payload(d).get("contract_override") is True]


# --- API ---------------------------------------------------------------------------


class Deployments:
    def __init__(self, repo: str, api: Api = gh_api) -> None:
        self.repo = repo
        self.api = api

    def list(self, env: str) -> list[dict]:
        return _lines(self.api(
            ["--paginate", f"repos/{self.repo}/deployments?environment={env}&task={TASK}&per_page=100",
             "--jq", ".[] | @json"],
            None,
        ))

    def statuses(self, deployment_id: int) -> list[dict]:
        return _lines(self.api(
            ["--paginate", f"repos/{self.repo}/deployments/{deployment_id}/statuses?per_page=100",
             "--jq", ".[] | @json"],
            None,
        ))

    def load(self, env: str) -> tuple[list[dict], dict[int, list[dict]]]:
        deployments = ours(self.list(env))
        return deployments, {d["id"]: self.statuses(d["id"]) for d in deployments}

    def create(self, env: str, sha: str, mode: str, payload: dict) -> int:
        body = {
            "ref": sha,
            "environment": env,
            "task": TASK,
            "auto_merge": False,
            "required_contexts": [],
            "production_environment": env == "production",
            "description": f"{mode} {sha[:7]}",
            "payload": payload,
        }
        result = self.api(["-X", "POST", f"repos/{self.repo}/deployments"], body)
        if result.code != 0 and _is_branch_policy_refusal(result):
            body = {**body, "ref": "main", "description": f"{mode} {sha[:7]} (ref main: branch policy)"}
            result = self.api(["-X", "POST", f"repos/{self.repo}/deployments"], body)
        if result.code != 0:
            raise ApiError(result.stderr.strip() or result.stdout.strip())
        return int(json.loads(result.stdout)["id"])

    def set_status(self, deployment_id: int, state: str, description: str = "",
                   environment_url: str = "", log_url: str = "") -> None:
        body: dict = {"state": state}
        if description:
            body["description"] = description[:140]
        if environment_url:
            body["environment_url"] = environment_url
        if log_url:
            body["log_url"] = log_url
        result = self.api(
            ["-X", "POST", f"repos/{self.repo}/deployments/{deployment_id}/statuses"], body
        )
        if result.code != 0:
            raise ApiError(result.stderr.strip() or result.stdout.strip())


def _is_branch_policy_refusal(result: ApiResult) -> bool:
    text = f"{result.stdout}\n{result.stderr}"
    return "422" in text and any(m in text for m in BRANCH_POLICY_MARKERS)


# --- CLI ---------------------------------------------------------------------------


def _bool(value: str) -> bool:
    if value.lower() in {"true", "1", "yes"}:
        return True
    if value.lower() in {"false", "0", "no", ""}:
        return False
    raise argparse.ArgumentTypeError(f"not a boolean: {value!r}")


def default_repo() -> str:
    repo = os.environ.get("GITHUB_REPOSITORY")
    if repo:
        return repo
    return subprocess.run(
        ["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
        check=True, capture_output=True, text=True,
    ).stdout.strip()


def run_url() -> str:
    server = os.environ.get("GITHUB_SERVER_URL", "https://github.com")
    repo, run_id = os.environ.get("GITHUB_REPOSITORY"), os.environ.get("GITHUB_RUN_ID")
    return f"{server}/{repo}/actions/runs/{run_id}" if repo and run_id else ""


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("current")
    p.add_argument("--env", required=True)
    p = sub.add_parser("ever-succeeded")
    p.add_argument("--env", required=True)
    p.add_argument("--sha", required=True)
    p = sub.add_parser("overrides-between")
    p.add_argument("--env", required=True)
    p.add_argument("--from", dest="from_sha", required=True)
    p.add_argument("--to", dest="to_sha", required=True)
    p = sub.add_parser("create")
    p.add_argument("--env", required=True)
    p.add_argument("--sha", required=True)
    p.add_argument("--mode", required=True, choices=["deploy", "rollback"])
    p.add_argument("--previous", default="")
    for flag in ("--allow-contract", "--allow-unstaged", "--ack-review", "--contract-override"):
        p.add_argument(flag, type=_bool, default=False)
    p = sub.add_parser("status")
    p.add_argument("--id", type=int, required=True)
    p.add_argument("--state", required=True, choices=["in_progress", "success", "failure", "error"])
    p.add_argument("--description", default="")
    p.add_argument("--environment-url", default="")
    p = sub.add_parser("show")
    p.add_argument("--env", required=True)
    p.add_argument("--sha", required=True)
    p = sub.add_parser("history")
    p.add_argument("--env", required=True)
    return parser


def main(argv: list[str], api: Api = gh_api) -> int:
    args = build_parser().parse_args(argv[1:])
    gh = Deployments(args.repo or default_repo(), api)
    try:
        if args.command == "current":
            sha = pick_current(*gh.load(args.env))
            if sha:
                print(sha)
            return 0
        if args.command == "ever-succeeded":
            deployments, statuses = gh.load(args.env)
            hit = any(target_sha(d) == args.sha for d in successful(deployments, statuses))
            return 0 if hit else 1
        if args.command == "overrides-between":
            found = overrides_between(*gh.load(args.env), args.from_sha, args.to_sha)
            for d in found:
                print(f"{target_sha(d)} deployment {d['id']} carried contract_override")
            return 1 if found else 0
        if args.command == "create":
            payload = {
                "target_sha": args.sha,
                "mode": args.mode,
                "previous_sha": args.previous,
                "allow_contract_migration": args.allow_contract,
                "allow_unstaged_sha": args.allow_unstaged,
                "acknowledge_migration_review": args.ack_review,
                "contract_override": args.contract_override,
                "run_id": os.environ.get("GITHUB_RUN_ID", ""),
                "actor": os.environ.get("GITHUB_ACTOR", ""),
            }
            deployment_id = gh.create(args.env, args.sha, args.mode, payload)
            gh.set_status(deployment_id, "in_progress", log_url=run_url())
            print(deployment_id)
            return 0
        if args.command == "status":
            gh.set_status(args.id, args.state, args.description, args.environment_url, run_url())
            return 0
        if args.command == "show":
            deployments, _ = gh.load(args.env)
            matches = [d for d in deployments if target_sha(d) == args.sha]
            if not matches:
                return 1
            d = matches[-1]
            print(json.dumps({
                "id": d["id"], "created_at": d.get("created_at"),
                "creator": (d.get("creator") or {}).get("login"), "payload": _payload(d),
            }, indent=2))
            return 0
        if args.command == "history":
            deployments, statuses = gh.load(args.env)
            for d in reversed(successful(deployments, statuses)):
                creator = (d.get("creator") or {}).get("login", "")
                print(f"{target_sha(d)} {d.get('created_at', '')} {creator}")
            return 0
    except ApiError as exc:
        print(f"::error::GitHub API: {exc}", file=sys.stderr)
        return 2
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
