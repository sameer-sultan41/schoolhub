# 0012. Frontend tests live in sibling `__tests__/` folders

- **Status:** Accepted
- **Date:** 2026-09-26 (recording a decision already in effect)
- **Enforced by:** the `test-placement` job ("Frontend tests live in __tests__/") in `repo-hygiene.yml`, which fails on any `*.test.ts(x)` outside `__tests__/` under `apps/*/src` and `packages/*/src`

## Context

Tests for `packages/ui`, `apps/dashboard`, `apps/website` and `packages/api-client` were moved
out of flat co-location into sibling `__tests__/` folders across several PRs (commits
`08d1d94`, `80f4af0`; recorded in `22f7855`). The convention was never enforced. Seven
dashboard tests were flat again by 2026-09-26, including four that `80f4af0` had already moved:
`src/proxy.test.ts` and `src/lib/{env,host,query-client}.test.ts`. All seven were moved back in
the PR that added the CI check.

## Decision

A test for `src/foo/bar.ts` lives at `src/foo/__tests__/bar.test.ts`. New tests go straight
into `__tests__/`. The backend keeps Django's convention of `apps/<module>/tests/` (or
`<resource>/tests/`), and Playwright specs live in `e2e/tests/`.

## Alternatives considered

- **Flat co-location (`bar.test.ts` beside `bar.ts`)** — why not: source directories fill
  with test files, and both conventions existing at once meant every new test was a coin
  toss. Picking one mattered more than which one.
- **A mirrored top-level `test/` tree** — why not: the tests drift away from the code they
  cover, and moving a module means moving two trees.

## Consequences

The drift shows that a written rule is not enough, so it gets a CI check. Jest's `testMatch`
still finds flat files, so a stray one runs and passes silently. That is why the check must
fail loudly, rather than narrowing `testMatch`, which would let a stray test silently stop
running.
