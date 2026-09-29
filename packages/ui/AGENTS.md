# AGENTS.md — packages/ui

Instructions for AI assistants working on SchoolHub's shared UI primitives, used by both
`apps/dashboard` and `apps/website`. Read the root [`../../AGENTS.md`](../../AGENTS.md) first.
The decision this file applies is [ADR-0009](../../docs/decisions/0009-ported-ui-primitives.md).

## Sourcing: port vendor source, never hand-roll

Before building any new primitive, find an existing implementation to port:

1. **The Metronic Next.js template first.** A purchased, licensed admin template covering
   full dashboards, pages and complex widgets (data grids with pinning/resizing/column-drag,
   page layouts). It is checked out locally at `/Users/avialdo/Documents/metronic nextjs` —
   outside this repo; `ls`/`grep` straight into it. Almost every primitive here is already a
   Metronic port (`docs/project-status.md` §Done).
2. **shadcn/ui's registry** (https://ui.shadcn.com/docs/components) where Metronic has no
   equivalent. `Sidebar` is a shadcn port.

Port one component or pattern at a time and rewrite it to this repo's conventions — including
server-driven data and URL-backed filters where the template assumes client-side state.

**Licence.** Metronic is a purchased, licensed asset that this repo's rules have always said
must not be committed or redistributed wholesale. The repository is now public, which puts the
vendored CSS under `src/styles/metronic/` and the ported components on public view — an open
question recorded in ADR-0009 for the owner. Don't vendor further Metronic source wholesale
while that stands.

## Never drop to a raw native element — compose from existing primitives

Even inside `packages/ui` itself, a component's markup is built from this package's own
primitives (`Button`, `Input`, `Checkbox`, …), never a bare `<button>`, `<input>`, or other
raw interactive HTML tag with hand-rolled styling. This held even when working around a
vendor library's own behavior: `drawer.tsx`'s built-in close button needed to bypass vaul's
`Drawer.Close` (which silently no-ops when a consumer sets `dismissible={false}` — confirmed
against vaul's own source), and the first fix reached for a plain `<button>` instead of
`Button` — wrong call, fixed to `<Button variant="ghost" mode="icon" onClick={...}>`. Working
around one library's limitation is never a reason to skip another (this package's own theme
system) — style and behavior (focus rings, hover/opacity states, disabled handling) live in
`Button`/`Input`/etc. exactly once; a hand-rolled raw tag reintroduces all of that per call site
and drifts from the theme the moment either changes.

This applies to `apps/dashboard`/`apps/website` feature code too, not just this package: reach
for the themed primitive (`Button`, `Input`, `Select`, …) over a raw native element there as
well.

## Two adaptations on every port — not optional polish

1. **Logical direction.** Any `side`/direction prop is `start`/`end`, never physical
   `left`/`right`, and classes use logical utilities (`ms-`, `me-`, `ps-`, `pe-`, `start-*`,
   `end-*`) or `ltr:`/`rtl:` variants. Urdu (RTL) depends on every component agreeing; `Sheet`
   set this precedent and `theme.css` states "never use left/right offsets in components."
2. **No hardcoded English.** Any fallback text — an `sr-only` label, a defaulted prop like
   shadcn's `"Toggle Sidebar"`/`"Loading"` — becomes a **required** prop. This package has no
   i18n of its own, so a silent default always ships untranslated. `Dialog.closeLabel`,
   `Sheet.closeLabel`, `Button.loadingLabel` and `DataTable`'s `emptyState`/pagination labels
   are required props. `Popover.label` and `Checkbox.label` are optional but have no English
   default — acceptable only where the label is genuinely optional.

## Record every departure

Each ported file's header comment lists every change made to the vendor source and why. Worked
examples: `src/components/data-grid.tsx` (Metronic) and `src/components/sidebar.tsx` (shadcn,
including why a straight port would have broken RTL).

## Graduation rule

A component enters `packages/ui` only when a second app needs it, or when it is a primitive by
nature. App-coupled pieces (anything touching the session, permissions or preferences — the
dashboard shell's header and sidebar) stay in their app, because `apps/website` has no session.

## Tests

Tests live in sibling `__tests__/` folders
([ADR-0012](../../docs/decisions/0012-tests-in-dunder-tests.md)); load the `schoolhub-testing`
skill before writing one.
