#!/usr/bin/env python3
"""PreToolUse gate on ExitPlanMode: a Tier 2 plan needs an independent review first.

Registered in `.claude/settings.json`; the decision is recorded in
docs/decisions/0015-independent-plan-review.md. Claude Code sends the hook a JSON payload
on stdin whose `tool_input` carries the plan text (`plan`) and its file (`planFilePath`) —
confirmed by capturing a real payload on Claude Code 2.1.283.

A plan is allowed through when it contains any of:

- `**Work tier:** 0` or `**Work tier:** 1` at the start of a line — trivial or bounded work.
  ("Work tier", not "Tier": this repo already uses "Tier 0 — Foundation" etc. for module
  build order, and a build-order heading must never read as a review exemption);
- `**Review:** waived by user` — the user explicitly waived review (visible in the plan);
- an `## Independent review` section whose verdict is APPROVE or REVISE (findings folded in).

Otherwise it is denied with instructions to run the `plan-reviewer` agent. A RETHINK
verdict is denied too: the reviewer said the approach itself is wrong.

The gate FAILS OPEN. Any error — unreadable payload, missing plan file, an unexpected
shape — allows the call and prints a warning to stderr, because a broken gate must never
trap a session in plan mode. It never exits 2 (which Claude Code treats as "block").
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# A metadata line may sit in a bullet or a blockquote ("- **Work tier:** 1", "> ...").
LINE_START = r"^[ \t]*(?:[-*>][ \t]*)?"
TIER = re.compile(LINE_START + r"\*\*Work tier:\*\*\s*([0-9])\b", re.MULTILINE | re.IGNORECASE)
WAIVED = re.compile(LINE_START + r"\*\*Review:\*\*\s*waived by user\b", re.MULTILINE | re.IGNORECASE)
REVIEW_HEADING = re.compile(r"^##\s+Independent review\b", re.MULTILINE | re.IGNORECASE)
NEXT_SECTION = re.compile(r"^#{1,2}\s", re.MULTILINE)
VERDICT = re.compile(r"verdict[\s:*_]*\b(approve|revise|rethink)\b", re.IGNORECASE)
FENCED = re.compile(r"^(```|~~~).*?^\1[^\n]*$", re.MULTILINE | re.DOTALL)

DENY_UNREVIEWED = (
    "Work tier 2 plan (or no work tier stated) without an independent review. Dispatch the `plan-reviewer` agent on this "
    "plan (or run /review-plan <path>), fold its findings into the plan, append its "
    "`## Independent review` block (with its Verdict line) as plain markdown, not inside a "
    "code fence, then call ExitPlanMode again. "
    "If the work is genuinely work tier 0/1, say so with a `**Work tier:** 0` or `**Work tier:** 1` line; "
    "if the user explicitly waived review, add `**Review:** waived by user`."
)
DENY_RETHINK = (
    "The independent review's verdict is RETHINK — the approach itself was judged wrong. "
    "Revise the plan to address the reviewer's findings, re-run the `plan-reviewer` agent, "
    "and replace the `## Independent review` block with the new verdict before exiting "
    "plan mode."
)


def decide(plan: str) -> str | None:
    """Return a denial reason, or None to allow.

    Fenced code blocks are ignored, so a quoted template (`Verdict: APPROVE | REVISE | ...`)
    or an example tier line never counts. Each `## Independent review` section runs to the
    next H1/H2; verdicts are read from EVERY such section in document order and the last one
    wins — so a re-review appended as a new block supersedes the earlier round.
    """
    plan = FENCED.sub("", plan)
    tier = TIER.search(plan)
    if tier and tier.group(1) in {"0", "1"}:
        return None
    if WAIVED.search(plan):
        return None
    verdicts: list[str] = []
    for heading in REVIEW_HEADING.finditer(plan):
        rest = plan[heading.end() :]
        following = NEXT_SECTION.search(rest)
        verdicts += VERDICT.findall(rest[: following.start()] if following else rest)
    if verdicts:
        return DENY_RETHINK if verdicts[-1].lower() == "rethink" else None
    return DENY_UNREVIEWED


def plan_text(payload: dict) -> str:
    tool_input = payload.get("tool_input") or {}
    plan = tool_input.get("plan")
    if isinstance(plan, str) and plan.strip():
        return plan
    path = tool_input.get("planFilePath")
    if isinstance(path, str) and path:
        return Path(path).read_text(encoding="utf-8")
    raise ValueError("payload carries neither tool_input.plan nor tool_input.planFilePath")


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
        if payload.get("tool_name") not in (None, "ExitPlanMode"):
            return 0
        reason = decide(plan_text(payload))
        if reason:
            print(
                json.dumps(
                    {
                        "hookSpecificOutput": {
                            "hookEventName": "PreToolUse",
                            "permissionDecision": "deny",
                            "permissionDecisionReason": reason,
                        }
                    }
                )
            )
    except Exception as exc:  # fail open on anything, by design
        print(f"plan_review_gate: allowing ExitPlanMode, gate errored: {exc!r}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
