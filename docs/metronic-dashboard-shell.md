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

## Decisions

- **Port, don't vendor.** Root `AGENTS.md` §0d. Metronic's actual Demo1 source lives at
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
- **Behavior stays schoolhub's own.** `SidebarProvider`'s state machine (mobile Sheet,
  Ctrl/Cmd+B, cookie-persisted collapse via layout preferences, RTL logical positioning,
  i18n-required labels) is never replaced by Metronic's `useSettings`/`document.body`-class
  approach — only the visual shape is ported.

## Backlog (explicitly deferred, not lost)

- `AppBreadcrumb`, `CommandPalette` — restorable from `git show HEAD:apps/dashboard/src/components/<file>.tsx` for reference; need re-wiring into `app-shell.tsx`'s header once restored.
- `TenantTheme` / tenant branding CSS variables.
- Session/tenant resolution in `AppShell` (`useSession`, tenant `useQuery`, `tenantLabel` from real tenant name instead of `PLATFORM_NAME`), impersonation banner, sign-out (`UserMenu` currently renders with `user={null}`).
- `canAccessModule` permission filtering of `NAV_GROUPS` (currently unfiltered — every nav item renders regardless of the viewer's permissions).
- Nested/multi-level nav groups (`NavItem.children` exists on the type; nothing uses it yet).
- Every business route: students, staff, academics, timetable, admissions, attendance, fees, communication, website — plus the shared `ScreenHeader`/`ApiErrorAlert`/`FilterBar`/`PersonCell` components and the `useTableParams`-driven list-screen convention they supported.
- A dedicated RTL + dark-mode visual verification pass on the rebuilt shell specifically (the underlying primitives are already covered by existing tests/e2e; the new `app-shell.tsx`/`dashboard-nav.tsx` composition itself has only been unit-tested so far).
