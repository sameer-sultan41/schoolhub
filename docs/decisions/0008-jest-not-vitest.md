# 0008. Jest + React Testing Library, not Vitest

- **Status:** Accepted (replaced the Vitest recommendation the testing strategy originally made)
- **Date:** 2026-09-26 (recording a decision already in effect)
- **Enforced by:** `apps/dashboard/jest.config.ts`, `apps/website/jest.config.ts` (85% global `coverageThreshold`), run by `frontend.yml`'s "Test (coverage)" job

## Context

The testing strategy originally recommended Vitest. The team adopted Jest instead, and commit
`29892b1` ("Align the remaining testing references with Jest") updated
`docs/07-quality/testing-strategy.md` to match. `tech-stack.md` §8 pins Jest 30 as "Testing
standard for this project; Vitest is not used." The full trade-off discussion was not written
down; this record captures what is known so the question is not reopened by accident.

## Decision

Unit and component tests in `apps/dashboard`, `apps/website` and `packages/*` use Jest 30 with
React Testing Library. The apps use Next.js's first-party `next/jest` transform; the
packages (`packages/ui`, `packages/api-client`, `packages/types`) use `@swc/jest`. Browser-level
flows use Playwright in `e2e/`, never Jest.

## Alternatives considered

- **Vitest** — why not: `next/jest` is Next.js's own documented integration and the suite was
  already built on it. Switching runners means rewriting mocks and config across every
  workspace for no correctness gain.
- **Playwright component testing** — why not: it is slower, and the jsdom layer is enough for
  component logic. Real-browser behaviour already has its own suite.

## Consequences

Docs or plans that say "Vitest" are wrong and should be corrected when found. Anything that
needs a real database or real network belongs in `e2e/`'s `live` lane, not in Jest
([0003](0003-tenant-isolation-rls.md)).
