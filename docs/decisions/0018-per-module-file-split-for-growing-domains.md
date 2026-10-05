# 0018. A growing service module splits into constant/type/helper/schema files

- **Status:** Superseded by [0019](0019-every-module-uses-the-five-file-shape.md)
- **Date:** 2026-10-03
- **Enforced by:** review only — `schoolhub-api-services` skill checklist, `change-reviewer` agent

## Context

`schoolhub-api-services/SKILL.md` originally said a domain's service module is exactly three
files (`endpoints.ts` entry, `<domain>-service.ts`, `index.ts`) and explicitly rejected a
per-module `type.ts` split as "a second source of truth" for the domain's wire shape. That
reasoning holds for the wire shape itself — [ADR-0017](0017-generated-wire-types-for-new-domains.md)
already settled where `StudentRecord` (`= ApiSchemas["Student"]`) lives and is still followed
here. It does not, on its own, justify cramming every other concern into one file forever.

Building out `students`, `<domain>-service.ts` and the feature files around it accumulated,
independently of the wire shape: five hand-written input/query interfaces and a view-model
type (`StudentRow`), a set of cross-file magic-string constants (`"active"`, `"all"`, a column
sort-field map), two pure mapper/formatter helpers duplicated-by-comment from a sibling module,
and two Zod schemas whose inferred types were each imported into five-plus feature files. None
of this is the wire shape question ADR-0017 answered; it is a file-organization question the
original skill text answered too early, for a domain that at the time had none of this.

## Decision

Once a domain's service module has accumulated enough of a given concern to make
`<domain>-service.ts` or a feature file the de facto (but unlabeled) source of truth for it,
split that concern into its own file under `services/modules/<domain>/`:

```
services/modules/<domain>/
  <domain>-service.ts    # apiClient calls only — imports its types from ./<domain>-type
  <domain>-type.ts       # domain types: the generated wire-shape alias, hand-written
                         # input/query interfaces, and shared view-model types
  <domain>-constant.ts   # cross-file magic strings/numbers and lookup objects
  <domain>-helper.ts     # pure functions (mappers, formatters) — no React, no API calls
  <domain>.schema.ts     # Zod schemas and their inferred form-values types
  index.ts                # re-exports as `<Domain>Service`
```

A new domain still starts as the original three files — do not pre-create an empty split for
a domain that has none of this yet (`students` itself started that way: `constant.ts`/`type.ts`
were empty placeholders until the constants and types that justified them existed). Split a
concern out once a second file would otherwise duplicate or reach across the module for it —
not before. The wire shape alias (`StudentRecord` et al.) still comes from
`ApiSchemas["<Model>"]` per ADR-0017; moving it into `<domain>-type.ts` is relocation, not a
second source of truth, exactly as long as nothing hand-rolls a competing definition of that
same shape elsewhere.

A Zod schema and its inferred type stay together in `<domain>.schema.ts`; form *logic* built on
top of a schema (defaults, record↔form-values mappers, submit-payload builders) stays in its
own feature file, importing the schema/type rather than redeclaring it — splitting a schema
from its own inferred type across two files creates the exact circular-import risk this
decision is trying to avoid elsewhere.

## Alternatives considered

- **Keep the original three-file shape for every domain, forever.** Why not: this is what the
  skill said until now, and it meant `students-service.ts` carried five type declarations
  that had nothing to do with an API call, while `"active"` and `"all"` were hand-typed at
  five-plus call sites with no single definition a reviewer could point to as canonical.
- **Move the split concerns into `packages/types`/a shared `lib/` helper instead of keeping
  them per-domain.** Why not: these are not cross-cutting (nothing outside `students` needs
  `STUDENT_WITHDRAWABLE_STATUS` or `toStudentRow`) — `packages/types` is reserved for the
  genuinely cross-cutting, no-generated-source case ADR-0017 already carves out.
- **Split every domain into these five files immediately, regardless of size.** Why not: a
  domain with one or two functions and no shared constant gains nothing from five near-empty
  files — the split is justified by actual accumulation, not applied as a blanket template.

## Consequences

- `schoolhub-api-services/SKILL.md` and `apps/dashboard/AGENTS.md`'s "Adding a Module Screen"
  step 2 are updated in this same PR to describe the optional split and when to reach for it,
  so the next domain that grows this way doesn't re-litigate the same question.
- A domain that never accumulates enough of a concern to justify a file never gains one — this
  is not a mandatory five-file minimum, and a reviewer should push back on an empty split file
  added "for consistency" with nothing in it yet.
- `students` is the reference implementation for every one of these five files; `auth` remains
  the reference for the original three-file shape a smaller domain should still start from.
