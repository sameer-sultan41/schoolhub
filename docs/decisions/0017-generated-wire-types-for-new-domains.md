# 0017. Generated wire types for new domains

- **Status:** Accepted
- **Date:** 2026-09-30
- **Enforced by:** review only — no lint rule catches a hand-written domain interface that
  happens to compile; the next domain's plan review is what checks this

## Context

`schoolhub-api-services/SKILL.md` and `packages/types`' own header describe hand-maintained
domain types in `packages/types` as the target, following `auth.ts`. In practice, every domain
built since `auth` (`staff`, `dashboard`'s reference-data helpers) hand-rolled its wire types
locally in its own service file instead — `packages/types` has never gained a second domain.
Building `students`, a hand-written `StudentRecord` in `packages/types` drifted from the real,
already-generated contract (`packages/api-client`'s OpenAPI generator, which post-dates when
`auth.ts` was written) before a line of the rest of the module existed: it was missing
`custom_fields`, mistyped `address`, and got `admission_number`'s optionality backwards.

## Decision

A new domain's wire shape is the generated `ApiSchemas["<Model>"]` (`@schoolhub/api-client`),
type-aliased and re-exported from that domain's own `services/modules/<domain>/` (e.g.
`export type StudentRecord = ApiSchemas["Student"]`). Components import it from `@/services`,
never `@schoolhub/api-client` directly. `packages/types` keeps only genuinely hand-authored,
cross-cutting types with no generated source: the envelope/pagination primitives, auth/RBAC
types, tenant/website types, and small runtime value-arrays an enum-backed `<Select>` or
`z.enum(...)` needs (e.g. `GENDER_VALUES`) — the OpenAPI generator can emit these as a
`--enum-values` array too, which this repo's generator invocation does not currently turn on;
until it does, these hand-copied arrays are a second source of truth by necessity, not an
oversight, and are the one exception to "no second source of truth" below.

## Alternatives considered

- **Keep hand-maintaining `packages/types`, following `auth.ts` and the skill as written.**
  Why not: this is what the first draft of the `students` module did, and it drifted from the
  real contract before the rest of the module was even built — see Context.
- **Migrate `auth.ts` to the generated types now, for full consistency.** Why not: out of
  scope here and not free — `AuthenticatedUser` and friends predate a clean generated
  equivalent in places; a separate, deliberate migration, not a side effect of this decision.
- **Turn on the OpenAPI generator's `--enum-values` flag instead of hand-copying enum arrays.**
  Why not: a real option, deferred rather than rejected — it would remove the one exception
  this record carries, but changing the generator invocation is its own small change with its
  own blast radius (every other generated enum in the codebase), not bundled into this PR.

## Consequences

- No second source of truth to drift from the real contract, except the documented enum-array
  exception above.
- `auth.ts` stays as it is; migrating it is a separate, future decision.
- `schoolhub-api-services/SKILL.md`, `packages/types/src/index.ts`'s header,
  `docs/02-architecture/repo-structure.md` §2's "a shared TypeScript type → `packages/types`"
  row, and `apps/dashboard/AGENTS.md`'s matching guidance are all updated in this same PR to
  point here, so the next domain doesn't rediscover this the hard way a third time.
