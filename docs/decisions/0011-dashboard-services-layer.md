# 0011. Dashboard API calls go only through `src/services/`

- **Status:** Accepted
- **Date:** 2026-09-26 (recording a decision already in effect)
- **Enforced by:** ESLint `no-restricted-imports` in `apps/dashboard/eslint.config.mjs` (the `API_CLIENT` pattern from `packages/config/eslint.boundaries.mjs`), applied to the UI layers `src/app`, `src/features`, `src/components` and `src/hooks`; existing violations are frozen in `apps/dashboard/eslint-suppressions.json`

## Context

`apps/dashboard/src/lib/auth.ts` once mixed transport wiring (token store, refresh-on-401)
with auth API calls that each carried a hardcoded path string. That made its boundary
unclear and spread path strings through the codebase. The fix is documented in the
[`schoolhub-api-services`](../../.claude/skills/schoolhub-api-services/SKILL.md) skill.

## Decision

Every backend call follows a three-part shape:

1. **Paths** are registered in `src/services/endpoints.ts`.
2. **Calls** live in one thin service file per domain, `src/services/modules/<domain>/<domain>-service.ts`.
3. **Aggregation:** the service files are gathered as `Services` in `src/services/index.ts`.

Components and hooks call `Services.<domain>.<action>(...)` as their `queryFn`/`mutationFn`.
They never import `apiClient`, never import `@schoolhub/api-client`, and never write a path
string. `ApiError`, which feature code needs for `instanceof` checks, is re-exported from
`@/services`, so `@/services` is the UI's only import surface. Only the transport layer —
`src/services/**` and `src/lib/**` (auth, the query client) — imports `@schoolhub/api-client`;
`src/lib` sits below `src/services`, so it can't import the facade without inverting the layers.
Each domain gets its own module: staff calls belong in `services/modules/staff/`, not in
`Services.dashboard`.

## Alternatives considered

- **Call `apiClient` from components** — why not: path strings scatter, and every caller
  re-implements error handling.
- **Generated hooks per endpoint (orval-style)** — why not: yet another generator on top of
  [0005](0005-generated-api-contract.md), and it hides the TanStack Query key design that
  `src/lib/query-client.ts` owns.

## Consequences

Today the staff screens route through `Services.dashboard.*` — known drift, on the backlog.
`staff-directory-table.tsx` still imports `ApiError` from the client package; it is suppressed
in the baseline until the staff screens move to `src/features/staff/`. Query keys come from the `queryKeys` factory in
`src/lib/query-client.ts`, not inline arrays.
