# 0002. One monorepo, not four repositories

- **Status:** Accepted (supersedes the four-repository recommendation in the original `repo-structure.md`)
- **Date:** 2026-09-26 (recording a decision already in effect)
- **Enforced by:** review only

## Context

The original specification recommended four repositories: `schoolhub-api`,
`schoolhub-frontend`, `schoolhub-infra` and `schoolhub-docs`. In practice the contract between
backend and frontend drifted silently while they lived apart. The root
[`AGENTS.md`](../../AGENTS.md) recorded it: "A change that spans them is one pull request —
which is the point, because the contract between backend and frontend had already drifted
silently while they lived apart."

## Decision

Everything lives in one repository: the specification (`docs/`), the Django backend
(`apps/api`), both Next.js frontends (`apps/dashboard`, `apps/website`), shared TypeScript
packages (`packages/*`), the Playwright suite (`e2e/`) and infrastructure (`infra/`). A change
spanning backend and frontend is one pull request. The pnpm workspace lists members
explicitly, because `apps/api` is a uv-managed Python project, not a pnpm package.

## Alternatives considered

- **Four repositories (the original recommendation)** — why not: independent deploy
  cadence was not worth the contract drift it caused; the generated client could lag the
  API with no single CI run to catch it.
- **Two repositories (backend, frontend)** — why not: same drift problem, and the spec
  would still live apart from the code it governs.

## Consequences

CI must be path-filtered so a backend-only change does not run frontend jobs
(`.github/workflows/*.yml`). One PR can regenerate `openapi.yaml` and `schema.d.ts` together
(see [0005](0005-generated-api-contract.md)). Docs describing sibling repositories are stale
by definition and should be corrected when found.
