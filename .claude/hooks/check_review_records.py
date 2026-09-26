#!/usr/bin/env python3
"""CI check for ADR-0015: new or changed superpowers specs/plans carry a passing review.

Run by the `plan-review-record` job in .github/workflows/repo-hygiene.yml as
`python3 .claude/hooks/check_review_records.py origin/<base-branch>`. It applies exactly the
same rule as the ExitPlanMode gate by importing its `decide()` — one rule, two entry points —
so a RETHINK verdict, a verdict outside the review section, or a quoted template fails here
just as it would be denied there. Files dated before the rule was adopted are grandfathered by
the date prefix of their filename.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from plan_review_gate import decide  # sibling module; its directory is put on sys.path above

ADOPTED = "2026-09-26"
DATED = re.compile(r"^(\d{4}-\d{2}-\d{2})-")
PATHSPECS = ("docs/superpowers/specs/*.md", "docs/superpowers/plans/*.md")


def needs_review(path: str) -> bool:
    """True unless the file's name is dated before the adoption date.

    Undated files are NOT grandfathered — only a date prefix older than the rule earns an
    exemption, so a new plan saved without one can't slip through.
    """
    match = DATED.match(Path(path).name)
    return match is None or match.group(1) >= ADOPTED


def changed_files(base: str) -> list[str]:
    # check=True: a bad base ref must fail the job loudly, never look like "nothing changed".
    result = subprocess.run(
        ["git", "diff", "--name-only", "--no-renames", "--diff-filter=AM", f"{base}...HEAD", "--", *PATHSPECS],
        check=True,
        capture_output=True,
        text=True,
    )
    return [line for line in result.stdout.splitlines() if line.strip()]


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: check_review_records.py <base-ref>", file=sys.stderr)
        return 2
    failed = False
    for path in changed_files(argv[1]):
        if not needs_review(path):
            print(f"grandfathered: {path}")
            continue
        reason = decide(Path(path).read_text(encoding="utf-8"))
        if reason:
            failed = True
            print(f"::error file={path}::{reason} (Run /review-plan {path} — ADR-0015.)")
        else:
            print(f"ok: {path}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
