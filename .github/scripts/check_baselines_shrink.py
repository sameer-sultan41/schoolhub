#!/usr/bin/env python3
"""CI check (ADR-0014): lint baselines may only shrink.

    check_baselines_shrink.py <base-ref>

Compares every `eslint-suppressions.json` in the working tree with the same file at
<base-ref> (repo-hygiene passes HEAD^1, the base tip of the PR's merge commit). The change
fails if any file/rule pair appears that the base didn't have, or any count goes up. A file
renamed in the same diff carries its entries across (git rename detection), so moving a file
doesn't look like a new violation.

ESLint itself fails on suppressions that no longer match anything in a linted file (exit code
2), but it never looks at keys for files that no longer exist — so this check also fails on those
("run eslint --prune-suppressions"), otherwise a file later created at that path would silently
inherit the old suppressions.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path, PurePosixPath

BASELINE = "eslint-suppressions.json"


def _git(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], check=check, capture_output=True, text=True)


def baseline_files() -> list[str]:
    tracked = _git("ls-files").stdout.splitlines()
    untracked = _git("ls-files", "--others", "--exclude-standard").stdout.splitlines()
    return sorted({p for p in tracked + untracked if PurePosixPath(p).name == BASELINE})


def at_ref(ref: str, path: str) -> dict | None:
    """The baseline at ref, or None if the file didn't exist there (an empty `{}` is not None)."""
    result = _git("show", f"{ref}:{path}", check=False)
    return json.loads(result.stdout) if result.returncode == 0 else None


def stale_keys(after: dict, workspace: Path) -> list[str]:
    """Suppression keys naming files that no longer exist in the workspace."""
    return sorted(key for key in after if not (workspace / key).is_file())


def renames(ref: str) -> dict[str, str]:
    """new path -> old path, repo-relative, for files renamed between ref and the work tree."""
    out = _git("diff", "--name-status", "-M", ref, "--").stdout
    mapping: dict[str, str] = {}
    for line in out.splitlines():
        parts = line.split("\t")
        if parts[0].startswith("R") and len(parts) == 3:
            mapping[parts[2]] = parts[1]
    return mapping


def growth(before: dict, after: dict, moved: dict[str, str]) -> list[str]:
    """Every (file, rule) whose count rose or that is new. Keys are workspace-relative paths."""
    found: list[str] = []
    for file, rules in after.items():
        origin = before.get(file) or before.get(moved.get(file, ""), {})
        for rule, entry in rules.items():
            old = origin.get(rule, {}).get("count", 0)
            new = entry.get("count", 0)
            if new > old:
                found.append(f"{file}: {rule} {old} -> {new}")
    return found


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: check_baselines_shrink.py <base-ref>", file=sys.stderr)
        return 2
    ref = argv[1]
    moved_repo = renames(ref)
    failed = False
    for path in baseline_files():
        workspace = str(PurePosixPath(path).parent)
        prefix = "" if workspace == "." else workspace + "/"
        # Suppression keys are relative to the workspace; translate the repo-level renames.
        moved = {
            new[len(prefix):]: old[len(prefix):]
            for new, old in moved_repo.items()
            if new.startswith(prefix) and old.startswith(prefix)
        }
        before = at_ref(ref, path)
        after = json.loads(Path(path).read_text(encoding="utf-8"))
        stale = stale_keys(after, Path(workspace))
        for key in stale:
            print(f"::error file={path}::suppressions for {key}, which no longer exists — run `eslint --prune-suppressions` in {workspace}.")
        if before is None:
            print(f"new baseline: {path} (allowed once, when a workspace first gets one)")
            failed = failed or bool(stale)
            continue
        grew = growth(before, after, moved)
        for item in grew:
            print(f"::error file={path}::baseline grew — {item}. Fix the new violation instead of suppressing it.")
        failed = failed or bool(grew) or bool(stale)
        if not grew and not stale:
            print(f"ok: {path}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
