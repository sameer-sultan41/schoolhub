#!/usr/bin/env python3
"""Commit-message rules (ADR-0016), shared by the local commit-msg hook and CI.

    check_commit_msg.py <message-file>          # .githooks/commit-msg (a message being written)
    check_commit_msg.py --range <base>..<head>  # repo-hygiene.yml (commits about to land)

Rules:
1. Subject is a Conventional Commit, `type(scope)!: summary` with type in TYPES, or a subject
   git generates itself: `Merge …`, `Revert "…"`, `Reapply "…"`.
2. No AI attribution: no `Co-authored-by:` naming an AI tool, no "Generated with/by <AI tool>"
   line.
3. A `fix` commit names its cause: a body line `Root cause: <text on the same line>`. This is
   the anti-hotfix rule; writing the cause down forces finding it first.

Range mode checks what will land on `main` (PRs merge with merge commits, ADR-0006, so every
commit survives), so it additionally rejects `fixup!`/`squash!`/`amend!` commits and `diag:`
commits, which are fine locally but must not be merged (AGENTS.md stop rule 4).

Hook mode strips comment lines and everything below the scissors line, as git does, using the
repository's `core.commentChar`. Range mode strips nothing: git has already recorded the
message, and a subject such as `#42 fix login` really is the subject.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

TYPES = (
    "feat", "fix", "refactor", "test", "docs", "style", "chore",
    "ci", "perf", "build", "revert", "diag",
)  # fmt: skip
SUBJECT = re.compile(r"^(?P<type>" + "|".join(TYPES) + r")(\([^()\s][^()]*\))?!?: \S")
GIT_SUBJECT = re.compile(r'^(Merge |Revert "|Reapply ")')
LOCAL_ONLY_SUBJECT = re.compile(r"^(fixup|squash|amend)! ")
AI = r"(claude|anthropic|chatgpt|openai|gpt-?\d|copilot|codex|cursor|gemini|devin|\bai\b)"
CO_AUTHOR = re.compile(r"^\s*co-authored-by\s*:.*" + AI, re.IGNORECASE | re.MULTILINE)
GENERATED = re.compile(r"^\W*generated (with|by)\b.*" + AI, re.IGNORECASE | re.MULTILINE)
ROOT_CAUSE = re.compile(r"^root cause:[ \t]*\S", re.IGNORECASE | re.MULTILINE)
SCISSORS = " ------------------------ >8 ------------------------"


def strip_comments(message: str, comment_char: str = "#") -> str:
    """Drop comment lines and everything below the scissors line, as git does."""
    kept: list[str] = []
    for line in message.splitlines():
        if line.startswith(comment_char + SCISSORS):
            break
        if not line.startswith(comment_char):
            kept.append(line)
    return "\n".join(kept)


def problems(message: str, *, landing: bool = False) -> list[str]:
    """Return every rule the message breaks; an empty list means it passes.

    `landing=True` is range mode: the commit is about to be merged, so local-only commits
    (fixup!/squash!/amend!, diag:) are rejected too.
    """
    text = "\n".join(line.rstrip() for line in message.splitlines()).strip()
    if not text:
        return []  # git aborts an empty commit on its own
    subject, _, body = text.partition("\n")
    found: list[str] = []

    if CO_AUTHOR.search(text):
        found.append("remove the AI Co-authored-by trailer: commits carry no AI attribution (AGENTS.md)")
    if GENERATED.search(text):
        found.append('remove the "Generated with <AI tool>" line: commits carry no AI attribution (AGENTS.md)')

    if GIT_SUBJECT.match(subject):
        return found
    if LOCAL_ONLY_SUBJECT.match(subject):
        if landing:
            found.append("squash this fixup!/squash!/amend! commit before merging (git rebase -i --autosquash)")
        return found
    match = SUBJECT.match(subject)
    if not match:
        found.append(f"subject must be `type(scope): summary` with type in {{{', '.join(TYPES)}}}; got: {subject!r}")
    elif match.group("type") == "diag" and landing:
        found.append("diag: commits don't merge; diagnose on a throwaway draft PR (AGENTS.md stop rule 4)")
    elif match.group("type") == "fix" and not ROOT_CAUSE.search(body):
        found.append(
            "a fix commit needs a body line `Root cause: <what was actually wrong>` (ADR-0016); "
            "if the cause isn't known yet, it isn't time to commit the fix"
        )
    return found


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout


def check_range(rev_range: str) -> int:
    # A shallow clone cuts history at the boundary, so `base..head` would silently widen to
    # every commit below it. Refuse rather than report on the wrong set.
    if _git("rev-parse", "--is-shallow-repository").strip() == "true":
        print("::error::shallow clone: commit range is unreliable; check out with fetch-depth: 0")
        return 2
    shas = _git("log", "--no-merges", "--format=%H", rev_range).split()
    print(f"checking {len(shas)} commit(s) in {rev_range}")
    failed = False
    for sha in shas:
        message = _git("log", "-1", "--format=%B", sha)
        subject = message.strip().partition("\n")[0]
        issues = problems(message, landing=True)
        for issue in issues:
            print(f"::error::{sha[:10]} {subject!r}: {issue}")
        if not issues:
            print(f"ok: {sha[:10]} {subject}")
        failed = failed or bool(issues)
    return 1 if failed else 0


def comment_char() -> str:
    try:
        value = _git("config", "--get", "core.commentChar").strip()
    except subprocess.CalledProcessError:
        return "#"
    return value if len(value) == 1 else "#"  # "auto" can't be known here; git defaults to "#"


def main(argv: list[str]) -> int:
    if len(argv) == 3 and argv[1] == "--range":
        return check_range(argv[2])
    if len(argv) == 2:
        message = strip_comments(Path(argv[1]).read_text(encoding="utf-8"), comment_char())
        issues = problems(message)
        for issue in issues:
            print(f"✗ commit message: {issue}", file=sys.stderr)
        return 1 if issues else 0
    print("usage: check_commit_msg.py <message-file> | --range <base>..<head>", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
