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

The staff screens now route through `Services.staff.*` (`services/modules/staff/`, split per
[ADR-0018](0018-per-module-file-split-for-growing-domains.md) into its own
`staff-type.ts`/`staff-constant.ts`/`staff-helper.ts`/`staff.schema.ts`) — the drift this record
originally flagged is resolved, and the screens themselves moved from `src/app/(app)/staff/`
into `src/features/staff/`. Reference-data reads shared with other modules
(`fetchCampuses`/`fetchDepartments`/`fetchDesignations`) stay on `Services.dashboard`, since they
are not staff-specific. Query keys come from the `queryKeys` factory in
`src/lib/query-client.ts`, not inline arrays.
