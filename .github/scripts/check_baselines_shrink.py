#!/usr/bin/env python3
"""CI check (ADR-0014): lint baselines may only shrink.

    check_baselines_shrink.py <base-ref>

Three baselines, one rule — none may grow against <base-ref>:
- every `eslint-suppressions.json` (frontend, below);
- the backend's ratcheted `# noqa` codes (RATCHETED_NOQA under apps/api, migrations excluded) —
  RUF100 removes dead ones, this stops new ones;
- `KNOWN_VIOLATIONS` in apps/api/tests/test_import_boundaries.py — the test fails on stale
  entries, this stops new ones.

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

import ast
import json
import re
import subprocess
import sys
import tomllib
from pathlib import Path, PurePosixPath

BASELINE = "eslint-suppressions.json"
RATCHETED_NOQA = ("BLE001", "TID251")
NOQA = re.compile(r"#\s*noqa:\s*([A-Z0-9, ]+)")
BOUNDARIES_TEST = "apps/api/tests/test_import_boundaries.py"


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


def noqa_counts(ref: str | None) -> dict[str, int]:
    """Occurrences of each ratcheted noqa code under apps/api (migrations excluded).

    ref=None reads the working tree; otherwise the tree at ref (via `git grep <ref>`).
    """
    args = ["grep", "-h", "-I", "-E", "#[[:space:]]*noqa:"]
    if ref:
        args.append(ref)
    args += ["--", "apps/api", ":(exclude)apps/api/**/migrations/**"]
    out = _git(*args, check=False).stdout
    counts = {code: 0 for code in RATCHETED_NOQA}
    for line in out.splitlines():
        for match in NOQA.finditer(line):
            for code in (c.strip() for c in match.group(1).split(",")):
                if code in counts:
                    counts[code] += 1
    return counts


def known_violations(source: str) -> set[tuple[str, str]]:
    """Evaluate the KNOWN_VIOLATIONS literal from the boundaries test's source (no imports run)."""
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "KNOWN_VIOLATIONS" for target in node.targets
        ):
            expression = compile(ast.Expression(node.value), BOUNDARIES_TEST, "eval")
            # Literals, tuples, f-strings and generators only; no builtins are reachable.
            return set(eval(expression, {"__builtins__": {}, "frozenset": frozenset}))
    return set()


def selected_at(ref: str) -> list[str]:
    """ruff's `select` list in apps/api/pyproject.toml at ref ([] if unreadable)."""
    result = _git("show", f"{ref}:apps/api/pyproject.toml", check=False)
    if result.returncode != 0:
        return []
    return tomllib.loads(result.stdout).get("tool", {}).get("ruff", {}).get("lint", {}).get("select", [])


def rule_selects(rule: str, code: str) -> bool:
    """Whether a ruff selector selects a code: letters must match exactly, digits by prefix.

    `B` selects `B001` (flake8-bugbear) but not `BLE001` (flake8-blind-except); `TID` selects
    `TID251`; `TID251` selects only itself.
    """
    rule_match, code_match = re.fullmatch(r"([A-Z]+)(\d*)", rule), re.fullmatch(r"([A-Z]+)(\d+)", code)
    if not rule_match or not code_match:
        return rule == "ALL"
    return rule_match[1] == code_match[1] and code_match[2].startswith(rule_match[2])


def backend_growth(ref: str) -> list[str]:
    found: list[str] = []
    before, after = noqa_counts(ref), noqa_counts(None)
    base_selection = selected_at(ref)
    for code in RATCHETED_NOQA:
        # The PR that first selects a rule creates its baseline; it is only a ratchet from then on.
        if not any(rule_selects(rule, code) for rule in base_selection):
            continue
        if after[code] > before[code]:
            found.append(f"`# noqa: {code}` count {before[code]} -> {after[code]} under apps/api — fix the code instead")
    old = _git("show", f"{ref}:{BOUNDARIES_TEST}", check=False)
    if old.returncode == 0 and Path(BOUNDARIES_TEST).is_file():
        added = known_violations(Path(BOUNDARIES_TEST).read_text(encoding="utf-8")) - known_violations(old.stdout)
        found += [f"new KNOWN_VIOLATIONS entry {source} -> {target} — go through that app's services" for source, target in sorted(added)]
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
    backend = backend_growth(ref)
    for item in backend:
        print(f"::error::backend baseline grew — {item} (ADR-0013/ADR-0014).")
    if not backend:
        print("ok: backend noqa and KNOWN_VIOLATIONS baselines")
    return 1 if failed or backend else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
