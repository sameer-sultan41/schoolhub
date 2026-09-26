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
- an `## Independent review` section whose verdict is APPROVE or REVISE (findings folded in),
  and — when the payload's `transcript_path` is readable — a plan-reviewer run in that
  session's transcript, so the block can't simply be typed in by the planning agent.

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
# Anchored like TIER/WAIVED: a verdict starts its own line ("Verdict: APPROVE",
# "- **Verdict:** **REVISE** — …", "### Verdict: RETHINK"), so an incidental "verdict: approve"
# later in a finding's prose can't win. Markdown emphasis around either word is allowed.
VERDICT = re.compile(
    LINE_START + r"(?:#{1,6}[ \t]+)?[*_]*verdict[*_: \t]*(approve|revise|rethink)\b",
    re.MULTILINE | re.IGNORECASE,
)
# The user's `/review-plan` as the transcript records it: a user record whose text starts with
# the command tags (typed commands only — a quoted tag sits inside other text).
SLASH_REVIEW = re.compile(
    r"\s*<command-message>review-plan</command-message>\s*<command-name>/review-plan</command-name>"
)
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


def exempt(plan: str) -> bool:
    """Work tier 0/1, or review explicitly waived by the user. Fenced code blocks don't count."""
    plan = FENCED.sub("", plan)
    tier = TIER.search(plan)
    return bool(tier and tier.group(1) in {"0", "1"}) or bool(WAIVED.search(plan))


def decide(plan: str) -> str | None:
    """Return a denial reason, or None to allow.

    Fenced code blocks are ignored, so a quoted template (`Verdict: APPROVE | REVISE | ...`)
    or an example tier line never counts. Each `## Independent review` section runs to the
    next H1/H2; verdicts are read from EVERY such section in document order and the last one
    wins — so a re-review appended as a new block supersedes the earlier round.
    """
    if exempt(plan):
        return None
    plan = FENCED.sub("", plan)
    verdicts: list[str] = []
    for heading in REVIEW_HEADING.finditer(plan):
        rest = plan[heading.end() :]
        following = NEXT_SECTION.search(rest)
        verdicts += VERDICT.findall(rest[: following.start()] if following else rest)
    if verdicts:
        return DENY_RETHINK if verdicts[-1].lower() == "rethink" else None
    return DENY_UNREVIEWED


def reviewer_ran(payload: dict) -> bool | None:
    """Whether the session transcript shows a plan-reviewer run: True, False, or None if unknown.

    Binds the review block to an actual review: without this, an agent could write the
    `## Independent review` heading and a verdict itself. None (no or unreadable transcript)
    fails open, like every other error in this gate.
    """
    path = payload.get("transcript_path")
    if not isinstance(path, str) or not path:
        return None
    try:
        with open(path, encoding="utf-8", errors="replace") as transcript:
            for line in transcript:
                if "plan-reviewer" not in line and "review-plan" not in line:
                    continue  # cheap pre-filter: nearly every line is neither
                try:
                    if is_reviewer_run(json.loads(line)):
                        return True
                except json.JSONDecodeError:
                    continue
        return False
    except OSError:
        return None


def is_reviewer_run(record: object) -> bool:
    """Whether one transcript record IS a plan-reviewer run, judged by its structure.

    An assistant tool call dispatching the `plan-reviewer` agent or the `review-plan` skill, or
    the user's `/review-plan` command record. Structure, not text: the same words quoted in
    prose, in a tool result or in a file the session read don't count.
    """
    if not isinstance(record, dict):
        return False
    message = record.get("message")
    content = message.get("content") if isinstance(message, dict) else None
    if record.get("type") == "user" and isinstance(content, str):
        return bool(SLASH_REVIEW.match(content))
    if record.get("type") != "assistant" or not isinstance(content, list):
        return False
    for item in content:
        if not isinstance(item, dict) or item.get("type") != "tool_use":
            continue
        tool_input = item.get("input")
        if not isinstance(tool_input, dict):
            continue
        if tool_input.get("subagent_type") == "plan-reviewer":
            return True
        if item.get("name") == "Skill" and tool_input.get("skill") == "review-plan":
            return True
    return False


DENY_UNATTESTED = (
    "The plan carries an `## Independent review` block, but this session's transcript shows no "
    "plan-reviewer run. The block must come from the reviewer: dispatch the `plan-reviewer` agent "
    "(or run /review-plan), fold in its findings, paste its block, then call ExitPlanMode again. "
    "If the review happened in another session, re-run it here, or ask the user to waive it."
)


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
        plan = plan_text(payload)
        reason = decide(plan)
        # Allowed on the strength of a review block alone: make sure a real plan-reviewer run
        # produced it. CI's check_review_records.py has no transcript, so this binding exists
        # only in the session gate (ADR-0015, "What the gate cannot prove").
        if reason is None and not exempt(plan) and reviewer_ran(payload) is False:
            reason = DENY_UNATTESTED
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
