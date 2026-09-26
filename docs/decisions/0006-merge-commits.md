# 0006. Pull requests land as merge commits, not squash

- **Status:** Accepted
- **Date:** 2026-09-26 (recording a decision already in effect)
- **Enforced by:** review only (planned: `.github/rulesets/main.json` corrected to allow merge commits and drop `required_linear_history`)

## Context

`.git-blame-ignore-revs` lists purely mechanical commits, such as the first repo-wide
Prettier pass, so `git blame` skips them. The root `AGENTS.md` records the constraint: "a
squash merge produces a brand-new SHA on `main` that was never listed in that file, so any
entry there silently stops doing anything (git does not warn on an unknown SHA)." Every PR
so far has merged this way (about 68 "Merge pull request" commits on `main`).

## Decision

PRs merge with `gh pr merge --merge` (a merge commit). The human merges; agents stop at
"PR open, CI green". If a PR is ever squash-merged anyway, update `.git-blame-ignore-revs`
with the real squashed SHA afterwards.

## Alternatives considered

- **Squash merge** — why not: it breaks `.git-blame-ignore-revs` silently, and it collapses
  the per-step commits that stacked PRs are reviewed by.
- **Rebase merge** — why not: it rewrites SHAs the same way squash does.

## Consequences

`main` history is non-linear. Throwaway commits (for example `diag:` experiments) become
permanent once merged, so diagnose on a draft PR that is closed without merging.

Two recorded facts were wrong when this ADR was written. `docs/project-status.md` said merge
commits were disabled, but GitHub's own setting shows them allowed. And the committed ruleset
requires linear history, which contradicts this decision. The repository is now **public**,
so the ruleset — previously blocked because private repos need GitHub Pro — can actually be
applied once corrected.
