# 0019. Every service module uses the five-file shape from creation

- **Status:** Accepted
- **Date:** 2026-10-04
- **Enforced by:** review only — `schoolhub-api-services` skill checklist, `change-reviewer` agent

## Context

[ADR-0018](0018-per-module-file-split-for-growing-domains.md) introduced the
`<domain>-type.ts`/`<domain>-constant.ts`/`<domain>-helper.ts`/`<domain>.schema.ts` split, but
gated it on accumulation: a domain starts as the original three files (`endpoints.ts` entry,
`<domain>-service.ts`, `index.ts`) and only gains a split file once a concern actually
accumulates enough to need one. `students` and `staff` both grew into the full five-file shape
this way; `auth` — one Zod schema with one consumer, no hand-written types, no shared
constants, no pure helpers — did not, and ADR-0018 named it as the reference for staying at
three files.

Revisiting this with `auth` as the concrete case: the per-domain judgment call ADR-0018 asks
for — "has this accumulated enough yet?" — is itself a recurring source of inconsistency
across domains and across sessions, each re-deciding where the line sits. Applying the same
five-file shape everywhere removes that judgment call entirely: a reader who knows one domain's
file layout knows every domain's file layout, regardless of size, and never has to check
whether a given domain happens to be "past the threshold" before looking for where a type or a
constant lives.

## Decision

Every domain, new or existing, uses the full five-file shape from creation:

```
services/modules/<domain>/
  <domain>-service.ts    # apiClient calls only — imports its types from ./<domain>-type
  <domain>-type.ts       # domain types: the generated wire-shape alias, hand-written
                         # input/query interfaces, and shared view-model types
  <domain>-constant.ts   # cross-file magic strings/numbers and lookup objects
  <domain>-helper.ts     # pure functions (mappers, formatters) — no React, no API calls
  <domain>.schema.ts     # Zod schemas and their inferred form-values types
  index.ts               # re-exports as `<Domain>Service`
```

A file with nothing to hold yet (no constants, no pure helpers) is still created, with a short
header comment saying so and an `export {};` to keep it a valid, empty module — not left out
until something accumulates. This reverses ADR-0018's "split a concern out once a second file
would otherwise duplicate... not before" rule and its explicit "a reviewer should push back on
an empty split file" guidance: those still describe good judgment about *when a file's content
is worth writing*, but no longer gate *whether the file exists*. The wire-shape-alias rule from
[ADR-0017](0017-generated-wire-types-for-new-domains.md) is unaffected: `<domain>-type.ts` for a
domain with no generated wire shape (`auth`) re-exports the real cross-cutting types from
`@schoolhub/types` rather than redefining them — a named entry point, not a second source of
truth.

`auth` is updated in the same PR as this record: `auth-type.ts` (re-exporting
`AuthenticatedUser`/`LoginCredentials`/`LoginResponse`), `auth.schema.ts` (`loginSchema`/
`LoginValues`, moved out of `login-form.tsx`), and empty-but-present `auth-constant.ts`/
`auth-helper.ts`.

## Alternatives considered

- **Keep ADR-0018's accumulation gate, carve out `auth` as a one-off exception.** Why not:
  this was the first option put back to the user, and rejected — it would have left the
  general policy (and the judgment call every other future domain re-faces) unchanged, which
  is exactly what this record is choosing to remove.
- **Leave `auth`'s shape alone, update nothing.** Why not: this is ADR-0018's status quo,
  already revisited and rejected by the same discussion that produced this record.

## Consequences

- `schoolhub-api-services/SKILL.md` and `apps/dashboard/AGENTS.md`'s "Adding a Module Screen"
  step 2 are updated in this same PR to describe the five-file shape as the default for a new
  domain, not a later-earned split.
- `auth` becomes a second reference implementation alongside `students`/`staff`, specifically
  for what an intentionally-thin domain's five files look like (two near-empty, two real).
- Every *other* existing domain this repo has today (`tenant`, `files`, `jobs`,
  `school-organization`, `dashboard`) still has only the original three files as of this
  record — bringing each of them up to the five-file shape is follow-up work, not done here;
  this record's scope is the policy plus `auth` as its first applied case.
- A reviewer no longer asks "has this domain accumulated enough to earn a split file?" — only
  "does this file's content make sense for what little or much this domain has," which for a
  thin domain can honestly be a one-line `export {};` and a comment.
