# 0007. CI is the source of truth; local hooks are split by cost

- **Status:** Accepted
- **Date:** 2026-09-26 (recording a decision already in effect)
- **Enforced by:** `.github/workflows/{api,frontend,repo-hygiene,e2e-live,infra-compose,infra-terraform}.yml`; `.githooks/pre-commit` and `.githooks/pre-push` (opt-in until the planned `prepare` script installs them)

## Context

Pass/fail must be one authority, not a matter of whose laptop ran what. Tests need
PostgreSQL 18 with RLS and a non-superuser role, which a laptop often lacks. Agents are
also instructed never to run test suites, linters or typechecks by hand, so that CI's
verdict — not a local claim — is what gets reported.

## Decision

**CI decides.** Agents commit, push, and read CI (`gh pr checks <n> --watch`,
`gh run view <id> --log-failed`). Git hooks run *automatically* as fast gates, split by
cost:

| Hook | Runs | Why there |
| ---- | ---- | --------- |
| `pre-commit` | staged files: ESLint, Prettier `--check`, ruff, cspell | fast; ESLint measured at under 1s warm, about 11s for a realistic multi-workspace commit, and it catches `no-floating-promises` before commit |
| `pre-push` | `main`-push block, `tsc`, mypy, graphify refresh | needs the whole project graph; too slow per commit |

A missing tool warns and skips rather than blocking; CI remains the authority. Work that
needs a tool run to *produce* files, such as lint suppression baselines, runs in a CI
`workflow_dispatch` job whose patch is downloaded and committed. It never runs on a laptop.

## Alternatives considered

- **Run the full suite locally before every push** — why not: the environment differs from
  CI, and a local "it passed" becomes a competing truth.
- **Everything in pre-commit** — why not: `tsc` and mypy are too slow per commit.
- **No local hooks** — why not: formatting, spelling and lint slips then cost a CI round trip
  each. That is visible today as "satisfy the linter" follow-up commits, because the hooks
  were never installed on the working clone.

## Consequences

The feedback loop is push → CI, so hooks must actually be installed to catch cheap errors
early. `SKIP_HOOKS=1` and `--no-verify` exist for humans in emergencies; agents never use
them.
