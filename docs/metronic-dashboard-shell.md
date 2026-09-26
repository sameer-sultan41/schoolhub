# Metronic dashboard shell — status & backlog

Tracks the `apps/dashboard` header/sidebar shell's rebuild against Metronic's real Demo1
template, in small chunks. Kept separate from `docs/project-status.md` (which just points
here) so this rebuild's blow-by-blow doesn't crowd that doc again.

## Status

**Chunk 1 (done): layout setup.** Every business route under `apps/dashboard/src/app/(app)`
and the entire `apps/dashboard/src/components/` directory had been deleted wholesale ahead
of this chunk, to force a clean rebuild instead of continuing to patch the previous
implementation. This chunk restored the infrastructure that deletion swept up as collateral
(`providers.tsx`, `theme-toggle.tsx`, `layout-controls.tsx`, `user-menu.tsx` — all restored
verbatim, unrelated to the shell/nav visual work) and rebuilt the shell itself from scratch:

- `apps/dashboard/src/components/dashboard-nav.tsx` — nav rendering on the existing
  `AccordionMenu` primitive (`packages/ui`), with `classNames` ported literally from
  Metronic's real `packages/ui/src/components/layouts/demo1/components/sidebar-menu.tsx`.
- `apps/dashboard/src/components/app-shell.tsx` — composes schoolhub's own
  `SidebarProvider`/`Sidebar`/`SidebarCollapseToggle` (untouched, already Metronic-matched:
  17.5rem/5rem width tokens, floating collapse toggle) with `DashboardNav`, a Metronic-shaped
  sidebar header row, and a content-side header bar carrying `SidebarTrigger` +
  `LayoutControls`/`ThemeToggle`/`UserMenu`.
- `apps/dashboard/src/app/(app)/layout.tsx` + a single placeholder `(app)/dashboard/page.tsx`
  (bare heading, no data fetching) so the shell has somewhere to render.

Not rebuilt in this chunk (see Backlog): session/tenant resolution, permission-filtered nav,
impersonation banner, sign-out, `AppBreadcrumb`, `CommandPalette`, every business route.

**Chunk 2 (done): header controls.** `command.tsx` and `app-breadcrumb.tsx` restored
verbatim (no session dependency). `command-palette.tsx` restored with its `useSession`/
`canAccessModule`/`hasPermission` filtering dropped — `canAccessModule(null, …)` always
returns `false`, so filtering against a nonexistent session would show nothing; it now
shows every `status: "ready"` nav item and every quick action unconditionally, matching
`dashboard-nav.tsx`'s own temporary stance. Both wired into `app-shell.tsx`'s header in the
pre-reset order (`SidebarTrigger` → `AppBreadcrumb` → spacer → `CommandPalette` →
`LayoutControls` → `ThemeToggle` → `UserMenu`).

**Chunk 3 (done): full shell reset onto `_metronic/`.** Chunks 1-2's approach — schoolhub's
own `SidebarProvider`/`app-shell.tsx`/`dashboard-nav.tsx` composition — was itself torn out
and replaced with a near-verbatim port of Metronic's actual Demo1 shell into
`apps/dashboard/src/app/(app)/_metronic/` (`shell.tsx`, `sidebar.tsx`, `sidebar-menu.tsx`,
`sidebar-header.tsx`, `header.tsx`, `settings-provider.tsx`, `menu-config.ts`, etc.). This
supersedes the "Behavior stays schoolhub's own" decision below, which described chunks 1-2
and is no longer accurate — see the correction inline. Every remaining business route and
the placeholder `/dashboard` page were removed as part of the same reset, and Metronic's
Demo1 preview was promoted to the real `/dashboard` route. Two gaps this chunk's review
caught were fixed in the same pass: `sidebar.tsx`'s root and the mobile `SheetBody` wrapping
`SidebarMenu` now carry `role="navigation"`/`aria-label={t("primary")}` (translated, matches
`e2e`'s `getByRole("navigation", { name: "Primary navigation" })`), and `shell.tsx` now has a
`window` keydown listener for Ctrl/Cmd+B that calls the same `storeOption` toggle
`sidebar-header.tsx`'s button already used.

## Decisions

- **Port, don't vendor.** [`packages/ui/AGENTS.md`](../packages/ui/AGENTS.md) (formerly root `AGENTS.md` §0d). Metronic's actual Demo1 source lives at
  `packages/ui/src/components/layouts/demo1/**`, copied in during an earlier PR
  (`2de85c5`) and deliberately excluded from `packages/ui/src/tsconfig.json`'s `include`
  (`layouts/`, `partials/`) — it imports from modules that don't exist in this repo
  (`@/providers/settings-provider`, `@/config/menu.config`, the vendor's own header-bar
  partials) and cannot compile as-is. It stays as reference-only source; this rebuild reads
  its real files and ports structure/classNames into actual schoolhub files rather than
  importing from it. `demo2`–`demo10` and `partials/` are left alone (not cleaned up, not
  used) — out of scope until/unless something actually needs them.
- **`--sh-color-chrome-*` is aliased 1:1 to page tokens**, not a separate recessed "ink
  frame" tier (an earlier design, deliberately retired). Confirmed against Metronic's own
  `bg-background`-only sidebar/header. See `packages/ui/src/styles/theme.css`'s own header
  comment for the full rationale.
- **~~Behavior stays schoolhub's own~~ — superseded by chunk 3.** This described chunks 1-2's
  `SidebarProvider` composition, which chunk 3 removed entirely. The shipped shell now uses
  Metronic's own `useSettings`/`document.body`-class approach verbatim (see
  `settings-provider.tsx`'s header comment), including mobile Sheet and collapse. Chunk 3
  brought behavior back in line on the two pieces this doc had promised — nav
  landmark/i18n label and Ctrl/Cmd+B — but via that `useSettings`/body-class mechanism, not
  `SidebarProvider`'s context/state-machine one. RTL logical positioning still holds, via the
  vendor `demo1.css`/`metronic-extras.css` rules the port carries over.

## Backlog (explicitly deferred, not lost)

- `TenantTheme` / tenant branding CSS variables.
- Session/tenant resolution in `AppShell` (`useSession`, tenant `useQuery`, `tenantLabel` from real tenant name instead of `PLATFORM_NAME`), impersonation banner, sign-out (`UserMenu` currently renders with `user={null}`).
- `canAccessModule`/`hasPermission` filtering, restored **together** in `dashboard-nav.tsx` (sidebar), `command-palette.tsx` (palette nav search + actions), and `app-shell.tsx` (`NAV_GROUPS` filtering) — all three currently show everything unconditionally and must regain filtering at the same time the session/tenant chunk above lands, so the sidebar and the palette never disagree about what a viewer can see.
- Nested/multi-level nav groups (`NavItem.children` exists on the type; nothing uses it yet).
- Every business route: students, staff, academics, timetable, admissions, attendance, fees, communication, website — plus the shared `ScreenHeader`/`ApiErrorAlert`/`FilterBar`/`PersonCell` components and the `useTableParams`-driven list-screen convention they supported.
- A dedicated RTL + dark-mode visual verification pass on the rebuilt shell specifically (the underlying primitives are already covered by existing tests/e2e; the new `app-shell.tsx`/`dashboard-nav.tsx` composition itself has only been unit-tested so far).
- Two `test.skip`s in `e2e/tests/dashboard/session.spec.ts` ("exchanges the refresh cookie..." and "sees no module links at all") — both need the session/permission-nav chunk above before they can pass again. `e2e/tests/dashboard/staff.spec.ts` was deleted outright (not skipped) since it tested the deleted `/staff` route end-to-end; a new one is written when that route comes back.
- Per-file test/e2e work is deliberately not being chased test-by-test right now — the user asked to skip test/e2e fixing until the UI itself is finalized. Re-enable the skips above and re-add route-level e2e coverage as each backlog item actually lands, not before.
- **CI's global coverage gate (85% statements/branches/lines/functions) is currently failing** (~82%/77%/83%/75% after chunk 2): `app-breadcrumb.tsx`, `command-palette.tsx`, and `command.tsx` have no test files of their own (deliberately, per the same skip-tests instruction), on top of the coverage the reset itself removed. Not fixed by lowering the threshold — that's a repo-wide policy change, not this rebuild's call to make unilaterally. Needs either the header-control tests restored or an explicit decision from the user on the threshold; flagged rather than worked around.
