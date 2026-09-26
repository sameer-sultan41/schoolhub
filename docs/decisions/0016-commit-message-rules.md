# 0016. Commit messages: conventional subjects, no AI attribution, fixes name their root cause

- **Status:** Accepted
- **Date:** 2026-09-26
- **Enforced by:** `.githooks/commit-msg` → `.githooks/lib/check_commit_msg.py` (installed automatically by the root `package.json` `prepare` script on `pnpm install`), and the `commit-messages` job ("Commit messages follow the convention") in `repo-hygiene.yml`, which runs the same script over every commit in a PR, plus the script's own unit tests. The CI job is advisory until it is added to `main`'s required status checks.

## Context

The repo's commit subjects already followed Conventional Commits by habit — all but one of the
last 300 non-merge subjects did (the exception, `30bfa19`, used a `lint:` type; lint-config
changes use `chore`, `ci` or `style`) — but nothing checked it. Two written rules were broken in practice:
41 commits carry a `Co-Authored-By` AI trailer that `AGENTS.md` forbids (35 of them on `main`),
and `fix` commits outnumbered `feat` about two to one, many of them follow-ups to an earlier fix
of the same symptom. A fix whose message cannot say what was actually wrong is usually a
symptom patch.

## Decision

Every commit's subject is `type(scope)!: summary`, with type one of `feat`, `fix`, `refactor`,
`test`, `docs`, `style`, `chore`, `ci`, `perf`, `build`, `revert`, `diag` (git's own `Merge`,
`Revert "…"` and `Reapply "…"` subjects pass). No commit carries a `Co-authored-by:` trailer
naming an AI tool, or a "Generated with/by <AI tool>" line — a human co-author (GitHub's
"commit suggestion" adds one) is fine. Every `fix` commit's body has a line
`Root cause: <what was actually wrong>`. `fixup!`/`squash!`/`amend!` and `diag:` commits are
allowed while working but rejected in CI, because with merge commits (ADR-0006) every commit in
a PR lands on `main`. One script holds the rules; the local hook and CI both run it.

## Alternatives considered

- **commitlint (npm)** — why not: a Node toolchain and config for three rules a 100-line stdlib
  script covers, and it can't express "fix commits need a Root cause line" without a custom
  plugin anyway.
- **Enforce only in the PR template** — why not: a template section is skippable and applies per
  PR, not per commit; the root cause belongs next to the change in `git log`.
- **Rewrite history to strip the 41 existing trailers** — why not: rewriting `main` breaks every
  clone and `.git-blame-ignore-revs`; the rule applies from here forward.

## Consequences

Local hooks now install themselves (`prepare`), so the pre-commit and pre-push gates that were
never enabled on working clones start running. A `fix` for trivial fallout (a lint rule CI
caught) still needs a one-line cause, e.g. `Root cause: ESLint's no-floating-promises flagged
the new handler`. Humans can bypass the hook with `--no-verify`; CI still reports the PR red,
and blocks the merge once the job is a required check.
