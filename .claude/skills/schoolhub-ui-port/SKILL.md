---
name: schoolhub-ui-port
description: Use when adding or porting a UI primitive or complex widget into packages/ui, or porting a Metronic/shadcn pattern into apps/dashboard — phrases like "add a date-range picker", "port the Metronic data grid", "bring in shadcn's combobox", "we need a stepper component", or any new file under `packages/ui/src/components/`. Covers where to source it (Metronic first, shadcn second), the two mandatory adaptations (logical direction, no hardcoded English), the departure log, and the licence rule. SKIP for app-level feature components that only compose existing primitives.
---

# SchoolHub UI Port Skill

## Why this exists

About 20 commits have ported Metronic or shadcn source into `packages/ui` and the dashboard
shell. The rules are settled in [ADR-0009](../../../docs/decisions/0009-ported-ui-primitives.md)
and `packages/ui/AGENTS.md`. A straight copy breaks Urdu (RTL) the moment it renders under
`dir="rtl"`, and ships untranslated English. This skill is the procedure.

## 1. Find the source — never hand-roll

1. **Metronic Next.js template** — checked out at `/Users/avialdo/Documents/metronic nextjs`
   (outside this repo). Search it first:
   ```bash
   grep -rl "DatePicker\|date-range" "/Users/avialdo/Documents/metronic nextjs" --include='*.tsx' | head
   ```
2. **shadcn/ui registry** (https://ui.shadcn.com/docs/components) if Metronic has nothing.
3. Check `packages/ui/src/components/` first — the component may already exist under another
   name (`dropdown-menu` vs `dropdown-menu-4`, `data-table` vs `data-grid`). Extend rather than
   add a near-duplicate.

**Licence:** port one component at a time and rewrite it. Don't vendor further Metronic source
wholesale — the repo is public and the licence question in ADR-0009 is open.

## 2. The two mandatory adaptations

**Logical direction.**
- Props: `side: "start" | "end"`, never `"left" | "right"`.
- Classes: `ms-`/`me-`, `ps-`/`pe-`, `start-*`/`end-*`, `border-s`/`border-e`, `rounded-s`/
  `rounded-e`, `text-start`/`text-end`; or `ltr:`/`rtl:` variants when the geometry genuinely
  differs. Centring with `left-[50%]` + `-translate-x-1/2` is fine.
- `packages/ui/src/components/sidebar.tsx`'s header explains why the shadcn original broke RTL.

**No hardcoded English.**
- Every `sr-only` label, placeholder, empty state or defaulted string becomes a **required** prop.
- Several strings → bundle them into one required `labels` object (see `DataGrid`'s `labels` and
  `DataTableSort`), so callers pass `t(...)` values once.
- Existing examples: `Dialog.closeLabel`, `Sheet.closeLabel`, `Button.loadingLabel`.

Also, where the vendor source assumes client-side state, adapt to this repo's server-driven data
and URL-backed filters: list data comes from the API page by page (`Services.<module>` via
TanStack Query), and filter/sort/page state lives in the URL so a view is shareable and survives
reload — not in component state.

**Porting into the dashboard shell** (`apps/dashboard/src/app/(app)/shell/`) follows the same
two adaptations and the same departure log; the result stays in the app, not `packages/ui`,
whenever it touches the session, permissions or preferences.

## 3. Write the departure log

The file header lists every departure from the vendor source and why — the worked example is
`packages/ui/src/components/data-grid.tsx`:

```ts
/**
 * <What it is and why it exists.>
 *
 * Ported from <Metronic path | shadcn registry item> rather than designed from scratch
 * (ADR-0009). Departures from that source, each one of this package's rules applied:
 *
 * 1. <e.g. every user-facing string is a required prop, bundled into `labels`>
 * 2. <e.g. `side` is "start" | "end"; classes use logical utilities>
 * 3. <anything else, with the reason>
 */
```

## 4. Wire and test

1. Export it from `packages/ui/src/index.ts`.
2. Colours only through theme tokens (`bg-primary`, `text-muted-foreground`) — never literals
   (`DESIGN.md`, ADR-0014).
3. Test in `packages/ui/src/components/__tests__/<name>.test.tsx` (ADR-0012) — load
   `schoolhub-testing`. Assert the labels you required actually render, and an RTL case where
   direction matters.
4. Graduation: a component belongs in `packages/ui` only if it's a primitive or a second app
   needs it; app-coupled pieces (session, permissions, preferences) stay in the app.
