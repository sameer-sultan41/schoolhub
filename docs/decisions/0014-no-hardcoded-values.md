# 0014. Every value has one owner — no hardcoding

- **Status:** Accepted
- **Date:** 2026-09-26
- **Enforced by:** partly — `apps/dashboard/src/i18n/messages.types-check.ts` (every `en` key present in `ur`), `apps/api/tests/test_endpoint_contracts.py` (declared permission keys are registered), the zod env modules (a missing variable fails at load). Frontend, via ESLint (shared pieces in `packages/config/eslint.boundaries.mjs`): `react/jsx-no-literals` (dashboard), a `process.env` ban outside the env modules, an inline-`queryKey` ban (dashboard), a physical-direction class ban, and `max-lines` 400 — with existing violations frozen per workspace in `eslint-suppressions.json`, which the `lint-baselines` job in `repo-hygiene.yml` allows only to shrink. Backend: ruff `TID251` bans `os.environ`/`os.getenv` outside `config/settings/*` and the entry points, and `apps/api/tests/test_env_example.py` keeps `.env.example` in step with what the settings read.

## Context

A value written in two places drifts. The audit found:

- about 31 English JSX literals in the dashboard, with 0 translation calls in `/staff`
- four `process.env` reads that bypass the typed env modules: `apps/website/src/proxy.ts:17`,
  `apps/website/src/app/api/revalidate/route.ts:30`,
  `apps/website/src/components/public-enquiry-form.tsx:52` and
  `packages/ui/src/lib/to-absolute-url.ts:3`, plus one `os.environ` read in
  `apps/api/core/rbac/management/commands/seed_e2e_data.py:67`
- 21 inline TanStack Query key arrays alongside a largely unused `queryKeys` factory
- hardcoded API paths in the website's enquiry form
- `batch_size=500` repeated 15 times in the backend

## Decision

Each kind of value has exactly one owner:

| Value | Owner |
| ----- | ----- |
| Dashboard user-facing text | `apps/dashboard/messages/{en,ur}.json` via next-intl. The website's chrome is exempt, because `website-builder.md` sets no i18n requirement for it |
| `packages/ui` text | Required props supplied by the caller ([0009](0009-ported-ui-primitives.md)) |
| Environment | One typed module per runtime: `apps/dashboard/src/lib/env.ts` (public `NEXT_PUBLIC_*` only); `apps/website/src/lib/env.ts` (server-only, holds secrets) plus a public-only `env.client.ts` for client components; `apps/api/config/settings/*` for Django; `e2e/src/env.ts` |
| API paths | `apps/dashboard/src/services/endpoints.ts` ([0011](0011-dashboard-services-layer.md)); on the website, a registry beside its fetch helper |
| Query keys | The `queryKeys` factory in `apps/dashboard/src/lib/query-client.ts` |
| Magic numbers (timeouts, page sizes, batch sizes, TTLs) | A named constant (`apps/dashboard/src/lib/constants.ts`, `core/api/pagination.py`, a module-level `UPPER_SNAKE` name) |
| Colours | Theme tokens (`--sh-*`); tenant branding flows through tenant settings |
| Layout direction | RTL-logical classes only |
| Permission keys | Literal `module.resource.action` strings next to where they're used, validated against the registry by contract test |

## Alternatives considered

- **Permission-key constants (`Perm.STUDENT_UPDATE`)** — why not: the registry plus
  `test_endpoint_contracts.py` already turn a typo into a failing test, so converting 276
  literals would be churn without added safety. The gap is inline keys inside method bodies,
  which the contract test will be extended to cover.
- **i18n for the website chrome now** — why not: no requirement exists; do it when the spec
  asks for it.

## Consequences

Existing violations are baselined and burned down module by module. New code can't add more
once the lint rules land.
