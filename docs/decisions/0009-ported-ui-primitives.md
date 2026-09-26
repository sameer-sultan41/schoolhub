# 0009. UI primitives are ported vendor source, adapted for RTL and i18n

- **Status:** Accepted — licence question open, see Consequences (supersedes the root `AGENTS.md` §0c "prefer shadcn/ui" rule and §0d's "never vendor the source wholesale", both of which predate the Metronic migration)
- **Date:** 2026-09-26 (recording a decision already in effect)
- **Enforced by:** TypeScript — label and fallback-text props are *required* (`Dialog.closeLabel`, `Sheet.closeLabel`, `Button.loadingLabel`, `DataTable`'s empty-state and pagination labels). The RTL rule is review only (planned: an ESLint physical-direction ban).

## Context

`packages/ui` is shared by both apps, and both must work in English (LTR) and Urdu (RTL).
Hand-rolling primitives had produced inconsistent, inaccessible components. The repo first
migrated to shadcn/ui ports, then (per `docs/project-status.md` §Done) re-based almost
every primitive on the purchased **Metronic** Next.js admin template, "ported verbatim
rather than adapted". `Sidebar` remains a shadcn port (`packages/ui/src/components/sidebar.tsx`
header). Metronic's own `css/` is vendored under `packages/ui/src/styles/metronic/`.

## Decision

A new primitive is **ported from vendor source, never hand-rolled**: Metronic first, shadcn/ui
where Metronic has no equivalent. Every port must make two adaptations:

1. **Logical direction.** `side`/direction props are `start`/`end`, and classes use logical
   utilities (`ms-`, `ps-`, `start-*`), never physical `left`/`right`.
2. **No hardcoded English.** Any fallback text, such as `sr-only` labels or defaulted
   strings, becomes a required prop, because `packages/ui` has no i18n of its own.

Each port's file header records every departure from the vendor source and why.
`data-grid.tsx` and `sidebar.tsx` are the worked examples.

## Alternatives considered

- **Hand-rolled primitives** — why not: already tried; they accumulated accessibility and
  consistency bugs that the vendors had solved.
- **Install shadcn/Metronic as packages** — why not: neither ships as a versioned library;
  both are copy-in source.
- **Port verbatim with no adaptation** — why not: physical `left`/`right` breaks the moment
  the tree renders under `dir="rtl"`.

## Consequences

**Open licence question, not resolved by this ADR.** Metronic is a purchased, licensed asset,
and the root `AGENTS.md` says it must not be redistributed. The repository is now **public**,
which makes both the vendored `styles/metronic/**` CSS and the ported components publicly
visible. The repository owner needs to decide on this; it's recorded here so it is not lost.
