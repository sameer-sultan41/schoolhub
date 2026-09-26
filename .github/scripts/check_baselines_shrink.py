#!/usr/bin/env python3
"""CI check (ADR-0014): lint baselines may only shrink.

    check_baselines_shrink.py <base-ref>

Three baselines, one rule — none may grow against <base-ref>:
- every `eslint-suppressions.json` (frontend, below);
- the backend's suppression comments — every form ruff honours: `# noqa[: …]`, file-level
  `# ruff: noqa[: …]` / `# flake8: noqa`, and `# ruff: ignore|file-ignore|disable[…]` — counted
  per rule code, and code-less noqa (which silences every rule) as blanket, in apps/api's
  non-test, non-migration Python. Every
  code whose rule the base already selects is ratcheted — derived from pyproject.toml, not a
  hand-kept list, so a rule selected later is covered without anyone remembering to add it.
  RUF100 removes dead noqas, ruff's PGH004 rejects blanket ones, and this stops new ones.
  Tests are out of scope (a test may legitimately suppress; per-file-ignores in pyproject.toml
  are the reviewed mechanism there), as are generated migrations;
- `KNOWN_VIOLATIONS` in apps/api/tests/test_import_boundaries.py — the test fails on stale
  entries, this stops new ones. It is read with `ast.literal_eval`, so it must stay a literal.

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
from collections import Counter
from pathlib import Path, PurePosixPath

BASELINE = "eslint-suppressions.json"
# Every suppression-comment form ruff honours (docs.astral.sh/ruff/linter, "Error suppression").
# A code is uppercase letters then digits; a list is separated by commas or spaces, never by a
# newline, and each code must end there (so "E2E_TENANT" on the next line is not code "E2").
CODE = r"[A-Z]+[0-9]+(?![A-Za-z0-9_])"
# `# noqa`, `#NOQA : E501, F401  reason`, and the file-level `# ruff: noqa[: …]` /
# `# flake8: noqa[: …]` ("#ruff:"/"#flake8:" are case-sensitive, "noqa" is not). No codes = blanket.
NOQA = re.compile(
    rf"#[ \t]*(?:(?:ruff|flake8)[ \t]*:[ \t]*)?(?i:noqa)(?:[ \t]*:[ \t]*(?P<codes>{CODE}(?:[ \t,]+{CODE})*))?"
)
# `# ruff: ignore[E501]` (one line), `# ruff: file-ignore[…]`, `# ruff: disable[…]` (a block).
BRACKETED = re.compile(r"#[ \t]*ruff[ \t]*:[ \t]*(?:ignore|file-ignore|disable)\[(?P<codes>[^\]]*)\]")
BLANKET = "blanket"
# Where noqa comments are ratcheted: apps/api's own Python, minus tests and generated migrations.
NOQA_SCOPE = (
    ":(glob)apps/api/**/*.py",
    ":(glob,exclude)apps/api/**/migrations/**",
    ":(glob,exclude)apps/api/**/tests/**",
    ":(glob,exclude)apps/api/**/test_*.py",
    ":(glob,exclude)apps/api/**/tests.py",
)
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


def count_noqa(text: str) -> Counter[str]:
    """Occurrences of each suppressed code in text, line by line; code-less noqa is BLANKET."""
    counts: Counter[str] = Counter()
    for line in text.splitlines():
        for match in NOQA.finditer(line):
            codes = match["codes"]
            counts.update(re.findall(CODE, codes) if codes else [BLANKET])
        for match in BRACKETED.finditer(line):
            counts.update(re.findall(CODE, match["codes"]))
    return counts


def noqa_counts(ref: str | None) -> Counter[str]:
    """count_noqa over NOQA_SCOPE: the working tree (ref=None, untracked files included, like
    baseline_files) or the tree at ref (`git grep <ref>`)."""
    pattern = ["-E", "noqa|ruff[[:space:]]*:"]  # a cheap superset; count_noqa does the parsing
    source = [*pattern, ref] if ref else ["--untracked", *pattern]
    result = _git("grep", "-h", "-I", "-i", *source, "--", *NOQA_SCOPE, check=False)
    if result.returncode > 1:  # 1 is "no match"; anything above is git failing
        raise RuntimeError(f"git grep failed: {result.stderr.strip()}")
    return count_noqa(result.stdout)


def known_violations(source: str, origin: str = BOUNDARIES_TEST) -> set[tuple[str, str]]:
    """The KNOWN_VIOLATIONS set in the boundaries test's source, read with ast.literal_eval.

    Accepts `KNOWN_VIOLATIONS = frozenset({...})`, a bare set literal, and an annotated form.
    Raises ValueError when there is no such assignment or it isn't a literal set of string
    pairs: a reader that quietly returned an empty set would let every addition through.
    """
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign):
            targets, value = node.targets, node.value
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            targets, value = [node.target], node.value
        else:
            continue
        if not any(isinstance(target, ast.Name) and target.id == "KNOWN_VIOLATIONS" for target in targets):
            continue
        if (  # frozenset({...}) / set({...}) / frozenset(): the calls literal_eval can't take
            isinstance(value, ast.Call)
            and isinstance(value.func, ast.Name)
            and value.func.id in {"frozenset", "set"}
            and len(value.args) <= 1
            and not value.keywords
        ):
            if not value.args:  # the PR that fixes the last violation empties the baseline
                return set()
            value = value.args[0]
        try:
            entries = ast.literal_eval(value)
        except (ValueError, TypeError, SyntaxError) as exc:
            raise ValueError(f"{origin}: KNOWN_VIOLATIONS must be a literal set of (source, target) pairs") from exc
        if not isinstance(entries, (set, frozenset)) or not all(
            isinstance(entry, tuple) and len(entry) == 2 and all(isinstance(part, str) for part in entry)
            for entry in entries
        ):
            raise ValueError(f"{origin}: KNOWN_VIOLATIONS must be a set of (source, target) string pairs")
        return set(entries)
    raise ValueError(f"{origin}: no KNOWN_VIOLATIONS assignment found")


def selected_at(ref: str) -> list[str]:
    """ruff's `select` + `extend-select` in apps/api/pyproject.toml at ref ([] if unreadable)."""
    result = _git("show", f"{ref}:apps/api/pyproject.toml", check=False)
    if result.returncode != 0:
        return []
    lint = tomllib.loads(result.stdout).get("tool", {}).get("ruff", {}).get("lint", {})
    return [*lint.get("select", []), *lint.get("extend-select", [])]


def rule_selects(rule: str, code: str) -> bool:
    """Whether a ruff selector selects a code: letters must match exactly, digits by prefix.

    `B` selects `B001` (flake8-bugbear) but not `BLE001` (flake8-blind-except); `TID` selects
    `TID251`; `TID251` selects only itself.
    """
    if rule == "ALL":  # letters-only, so it must be handled before the letter comparison
        return True
    rule_match, code_match = re.fullmatch(r"([A-Z]+)(\d*)", rule), re.fullmatch(r"([A-Z]+)(\d+)", code)
    if not rule_match or not code_match:
        return False
    return rule_match[1] == code_match[1] and code_match[2].startswith(rule_match[2])


def backend_growth(ref: str) -> list[str]:
    found: list[str] = []
    before, after = noqa_counts(ref), noqa_counts(None)
    base_selection = selected_at(ref)
    for code in sorted(after):
        if after[code] <= before[code]:
            continue
        if code == BLANKET:
            found.append(f"blanket `# noqa` count {before[code]} -> {after[code]} under apps/api — name the rule, or fix the code")
        # The PR that first selects a rule creates its baseline; it is only a ratchet from then on.
        elif any(rule_selects(rule, code) for rule in base_selection):
            found.append(f"`# noqa: {code}` count {before[code]} -> {after[code]} under apps/api — fix the code instead")
    old = _git("show", f"{ref}:{BOUNDARIES_TEST}", check=False)
    if old.returncode == 0 and Path(BOUNDARIES_TEST).is_file():
        current = known_violations(Path(BOUNDARIES_TEST).read_text(encoding="utf-8"))
        added = current - known_violations(old.stdout, f"{ref}:{BOUNDARIES_TEST}")
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
    try:
        backend = backend_growth(ref)
    except (ValueError, RuntimeError) as exc:
        print(f"::error::backend baselines could not be read — {exc}")
        return 1
    for item in backend:
        print(f"::error::backend baseline grew — {item} (ADR-0013/ADR-0014).")
    if not backend:
        print("ok: backend noqa and KNOWN_VIOLATIONS baselines")
    return 1 if failed or backend else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
