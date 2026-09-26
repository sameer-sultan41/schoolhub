# 0011. Dashboard API calls go only through `src/services/`

- **Status:** Accepted
- **Date:** 2026-09-26 (recording a decision already in effect)
- **Enforced by:** review only (planned: an ESLint `no-restricted-imports` ban on `@schoolhub/api-client` outside `src/services/**` and `src/lib/auth.ts`)

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
string. `ApiError`, which feature code needs for `instanceof` checks, is to be re-exported
from `@/services` so that `@/services` is the only import surface; until that lands, the
`schoolhub-api-services` skill's allowance for `import { ApiError } from
"@schoolhub/api-client"` stands, and the skill changes in the same PR as the re-export. Each domain gets its own module: staff calls belong in
`services/modules/staff/`, not in `Services.dashboard`.

## Alternatives considered

- **Call `apiClient` from components** — why not: path strings scatter, and every caller
  re-implements error handling.
- **Generated hooks per endpoint (orval-style)** — why not: yet another generator on top of
  [0005](0005-generated-api-contract.md), and it hides the TanStack Query key design that
  `src/lib/query-client.ts` owns.

## Consequences

Today the staff screens route through `Services.dashboard.*` — known drift. Five feature files
import `ApiError` straight from `@schoolhub/api-client`, which is allowed today and moves to
`@/services` when the re-export and the lint rule land. Query keys come from the `queryKeys` factory in
`src/lib/query-client.ts`, not inline arrays.
