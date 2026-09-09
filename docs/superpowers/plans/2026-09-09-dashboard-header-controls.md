# Dashboard Header Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore `AppBreadcrumb` and `CommandPalette` into `apps/dashboard/src/components/app-shell.tsx`'s header, so the Metronic-shaped shell's header row is complete (breadcrumb on the leading side, search/⌘K on the trailing side) — the next small chunk after the bare-minimum shell rebuild in `docs/metronic-dashboard-shell.md`.

**Architecture:** Both components were deleted along with the rest of `apps/dashboard/src/components/` when the shell was reset, and are recoverable verbatim (or near-verbatim) from git history at ref `a7149bf` (the commit before the reset). `AppBreadcrumb` has no session dependency and restores unchanged. `CommandPalette` normally filters its nav-search results and quick actions by the signed-in user's permissions via `useSession`/`canAccessModule`/`hasPermission` — but `AppShell` doesn't resolve a session yet (deferred to a separate, not-yet-started chunk), and `canAccessModule(null, ...)` always returns `false`, so wiring it in unchanged would make the palette show almost nothing. Adapted to drop the permission filtering for now, showing every `status: "ready"` nav item and every quick action unfiltered — the same temporary stance `dashboard-nav.tsx` already takes for the sidebar itself, so the palette and the sidebar agree on what's visible during this transitional period.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, `cmdk` (via a local `command.tsx` shadcn port), `next-intl`, pnpm workspaces + Turborepo.

**Spec:** `docs/metronic-dashboard-shell.md` (this rebuild's own status/backlog doc — its Backlog section lists "AppBreadcrumb, CommandPalette" as the first deferred item).

## Global Constraints

- **No new tests, and no test restoration, in this chunk.** Explicit instruction: skip test/e2e work until the UI itself is finalized. `app-breadcrumb.test.tsx` and `command-palette.test.tsx` exist in git history but are not restored here — that happens in a later "restore header-control tests" pass, tracked in the backlog doc. Do not add the usual write-test → verify-fail → implement → verify-pass steps to this plan's tasks; each task is restore/implement, wire in, commit.
- Never run tests/typecheck/lint locally except as a diagnostic when a hook or CI blocks progress and gives no detail — the standing rule this session has followed throughout. Commit, push, and read `gh pr checks <n>`/`gh run view <id> --log-failed` for the actual verdict.
- Every user-facing string goes through `next-intl` messages (`apps/dashboard/messages/{en,ur}.json`) — never a hardcoded literal. All strings this plan needs already exist (`nav.breadcrumb`, `nav.command.*`, `common.new`/`edit`/`import`, per-module `nav.*` keys) — confirmed present, no message-file edits needed.
- Every direction-sensitive class is a Tailwind logical property or an explicit `rtl:`/`ltr:` variant (root `AGENTS.md` §0c) — both restored files already follow this (`AppBreadcrumb`'s chevron uses `rtl:scale-x-[-1]`).
- `packages/ui` is untouched by this chunk — `command.tsx` stays in `apps/dashboard` per its own documented reasoning (only `apps/dashboard` uses a command palette; moving it to `packages/ui` is a decision for when a second app wants one).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/dashboard/src/components/command.tsx` (restore) | shadcn's `Command` primitives ported over `cmdk`, with required `title`/`description`/`closeLabel` props instead of English defaults. No behavior change from history. |
| `apps/dashboard/src/components/app-breadcrumb.tsx` (restore) | Derives a breadcrumb trail from the URL and `NAV_ITEMS`. No behavior change from history. |
| `apps/dashboard/src/components/command-palette.tsx` (restore, adapted) | ⌘K/Ctrl+K palette. Adapted to drop `useSession`/`canAccessModule`/`hasPermission` filtering for now (see Architecture above) — shows every ready nav item and every quick action unfiltered. |
| `apps/dashboard/src/components/app-shell.tsx` (modify) | Render `<AppBreadcrumb />` after `<SidebarTrigger />` and `<CommandPalette />` before `<LayoutControls />` in the header, matching the pre-reset layout exactly. |
| `docs/metronic-dashboard-shell.md` (modify) | Move "AppBreadcrumb, CommandPalette" from Backlog to Status; add a backlog note that the palette's permission filtering (and the sidebar's) both still need the session/tenant chunk. |

No other files change. `apps/dashboard/messages/{en,ur}.json` need no edits — every key both components use already exists.

---

## Task 1: Restore `command.tsx` and `app-breadcrumb.tsx` verbatim

**Files:**
- Create: `apps/dashboard/src/components/command.tsx`
- Create: `apps/dashboard/src/components/app-breadcrumb.tsx`

**Interfaces:**
- Produces: `Command`, `CommandDialog` (props: `title: string`, `description: string`, `closeLabel: string`, plus the rest of `Dialog`'s props), `CommandEmpty`, `CommandGroup`, `CommandInput`, `CommandItem`, `CommandList`, `CommandSeparator`, `CommandShortcut` — consumed by Task 2's `command-palette.tsx`.
- Produces: `AppBreadcrumb()` — a zero-prop component, consumed by Task 3's `app-shell.tsx`.
- Consumes: `NAV_ITEMS` from `@/lib/nav-items` (unchanged, already restored in the prior chunk), `Dialog`/`DialogContent`/`DialogDescription`/`DialogHeader`/`DialogTitle`/`cn` from `@schoolhub/ui` (unchanged).

- [ ] **Step 1: Restore both files from git history**

```bash
git show a7149bf:apps/dashboard/src/components/command.tsx > apps/dashboard/src/components/command.tsx
git show a7149bf:apps/dashboard/src/components/app-breadcrumb.tsx > apps/dashboard/src/components/app-breadcrumb.tsx
```

Neither file needs editing — both are self-contained and have no dependency on anything the reset removed (`NAV_ITEMS`, `@schoolhub/ui`'s `Dialog` family, and `cmdk` are all still present/installed).

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/src/components/command.tsx apps/dashboard/src/components/app-breadcrumb.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): restore the command primitive and breadcrumb

Both were deleted in the shell reset and have no session dependency, so
they restore unchanged from before the reset (a7149bf). Not wired into
app-shell.tsx yet — that's Task 3.
EOF
)"
```

---

## Task 2: Restore `command-palette.tsx`, adapted to skip permission filtering

**Files:**
- Create: `apps/dashboard/src/components/command-palette.tsx`

**Interfaces:**
- Consumes: `Command*` primitives from Task 1's `command.tsx`; `NAV_GROUPS` from `@/lib/nav-items`; `PALETTE_QUICK_ACTIONS` from `@/lib/quick-actions` (both unchanged, already present).
- Produces: `CommandPalette()` — a zero-prop component, consumed by Task 3's `app-shell.tsx`.

The version in history filters `NAV_GROUPS` by `canAccessModule(user, item.module)` and `PALETTE_QUICK_ACTIONS` by `hasPermission(user, action.permission)`, both sourced from `useSession()`. `AppShell` has no session yet, and `canAccessModule(null, ...)`/`hasPermission(null, ...)` both unconditionally return `false` (`apps/dashboard/src/lib/permissions.ts`), so leaving that filtering in would make the palette list nothing at all. Drop the session/permission dependency entirely for this chunk — filter only by `status === "ready"`, matching `dashboard-nav.tsx`'s own current temporary stance (it also shows every `NAV_GROUPS` entry unfiltered).

- [ ] **Step 1: Write the adapted implementation**

```tsx
// apps/dashboard/src/components/command-palette.tsx
"use client";

import { Button } from "@schoolhub/ui";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/command";
import { NAV_GROUPS } from "@/lib/nav-items";
import { PALETTE_QUICK_ACTIONS } from "@/lib/quick-actions";

/**
 * ⌘K / Ctrl+K navigation and actions.
 *
 * Deliberately discoverable rather than hidden behind the shortcut: the header renders a
 * visible trigger showing the key, because a keyboard-only feature is a feature most
 * people never learn exists.
 *
 * `planned` modules never appear here — a search result that navigates to a 404 is a
 * different and worse thing than a labelled "Soon" in the sidebar.
 *
 * Not permission-filtered yet: AppShell has no session to filter by (see
 * docs/metronic-dashboard-shell.md's backlog), and `canAccessModule`/`hasPermission` both
 * return false for a null user — filtering against them here would show nothing at all.
 * Every ready module and every quick action renders unconditionally, same temporary stance
 * `dashboard-nav.tsx` already takes for the sidebar. Restore the `useSession` filtering in
 * both places together, in the session/tenant chunk, not just here.
 */
export function CommandPalette() {
  const t = useTranslations("nav.command");
  const tNav = useTranslations("nav");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // metaKey AND ctrlKey: ⌘K on macOS, Ctrl+K everywhere else, one listener.
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setOpen((isOpen) => !isOpen);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const navGroups = NAV_GROUPS.map((group) => ({
    key: group.key,
    items: group.items.filter((item) => item.status === "ready"),
  })).filter((group) => group.items.length > 0);

  return (
    <>
      <Button
        variant="chrome-outline"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
        className="hidden gap-2 sm:inline-flex"
      >
        <Search aria-hidden="true" className="size-4" />
        {t("trigger")}
        <CommandShortcut>{t("shortcut")}</CommandShortcut>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={t("title")}
        description={t("description")}
        closeLabel={t("close")}
      >
        <CommandInput placeholder={t("placeholder")} />
        <CommandList>
          <CommandEmpty>{t("empty")}</CommandEmpty>

          {navGroups.map((group) => (
            <CommandGroup key={group.key} heading={tNav(`groups.${group.key}`)}>
              {group.items.map((item) => (
                <CommandItem
                  key={item.key}
                  value={tNav(item.key)}
                  onSelect={() => {
                    go(item.href);
                  }}
                >
                  <item.icon aria-hidden="true" />
                  {tNav(item.key)}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}

          {PALETTE_QUICK_ACTIONS.length > 0 ? (
            <>
              <CommandSeparator />
              <CommandGroup heading={t("actions")}>
                {PALETTE_QUICK_ACTIONS.map((action) => (
                  <CommandItem
                    key={action.key}
                    value={t(`action.${action.key}`)}
                    onSelect={() => {
                      go(action.href);
                    }}
                  >
                    <action.icon aria-hidden="true" />
                    {t(`action.${action.key}`)}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </CommandDialog>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/src/components/command-palette.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): restore the command palette without permission filtering

useSession/canAccessModule/hasPermission are dropped for now: AppShell has
no session yet, and both permission helpers return false for a null user,
which would make the palette list nothing. Shows every ready nav item and
every quick action unconditionally, matching dashboard-nav.tsx's own
current temporary stance. Restore real filtering in both places together
when the session/tenant chunk lands.
EOF
)"
```

---

## Task 3: Wire both into `app-shell.tsx`'s header

**Files:**
- Modify: `apps/dashboard/src/components/app-shell.tsx`

**Interfaces:**
- Consumes: `AppBreadcrumb` (Task 1), `CommandPalette` (Task 2).

- [ ] **Step 1: Add the imports**

```tsx
// apps/dashboard/src/components/app-shell.tsx — add alongside the existing @/components imports
import { AppBreadcrumb } from "@/components/app-breadcrumb";
import { CommandPalette } from "@/components/command-palette";
```

- [ ] **Step 2: Render them in the header**

Change the header's current children from:

```tsx
<SidebarTrigger toggleLabel={t("primary")} />
<div className="flex-1" />
<LayoutControls />
<ThemeToggle />
<UserMenu user={null} />
```

to:

```tsx
<SidebarTrigger toggleLabel={t("primary")} />
<AppBreadcrumb />
<div className="flex-1" />
<CommandPalette />
<LayoutControls />
<ThemeToggle />
<UserMenu user={null} />
```

This matches the pre-reset header's exact control order (`SidebarTrigger` → `AppBreadcrumb` → spacer → `CommandPalette` → `LayoutControls` → `ThemeToggle` → `UserMenu`).

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/app-shell.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): wire the breadcrumb and command palette into the header

Completes the header row's control set. UserMenu still renders with no
user — that's the session/tenant chunk, not this one.
EOF
)"
```

- [ ] **Step 4: Push and check CI for real breakage only**

```bash
git push
gh pr checks <n>
```

Per this chunk's own instruction to skip test/e2e work: a `Test (coverage)`/`E2E` failure caused by `app-shell.test.tsx` (or any other existing test) not accounting for the new header children is expected and not this task's job to fix — note it in `docs/metronic-dashboard-shell.md`'s backlog (Task 4) rather than chasing it. Only investigate `Lint · Typecheck`/`Build` failures, which would mean a real mistake in this diff (a bad import, a missing prop) rather than a test needing updates for new UI.

---

## Task 4: Update the status doc

**Files:**
- Modify: `docs/metronic-dashboard-shell.md`

- [ ] **Step 1: Move the finished item from Backlog to Status**

In the "Status" section, add a new entry after Chunk 1 describing this chunk: `AppBreadcrumb`/`command.tsx` restored verbatim; `CommandPalette` restored with permission filtering dropped for now (every ready nav item and quick action shown unconditionally); both wired into `app-shell.tsx`'s header in the pre-reset order.

Remove "`AppBreadcrumb`, `CommandPalette`" from the Backlog's first bullet (it named both as deferred with a restoration pointer — that pointer has now been followed).

- [ ] **Step 2: Add the follow-up note to Backlog**

Add a bullet: `CommandPalette`'s and the sidebar's permission filtering must be restored **together**, in the session/tenant chunk — `useSession`, `canAccessModule`/`hasPermission` in `command-palette.tsx`, and `canAccessModule` filtering of `NAV_GROUPS` in `app-shell.tsx`/`dashboard-nav.tsx`.

Add a bullet noting any test/e2e fallout from Task 3 that was deliberately left unaddressed (fill in the specific failing test name(s) once CI has actually run — do not guess here).

- [ ] **Step 3: Commit**

```bash
git add docs/metronic-dashboard-shell.md
git commit -m "docs: record header-controls restoration in the shell status doc"
```

- [ ] **Step 4: Push**

```bash
git push
```

---

## Self-Review

**1. Spec coverage.** `docs/metronic-dashboard-shell.md`'s backlog names exactly one item this plan addresses — "AppBreadcrumb, CommandPalette" — and every file that item implies (`command.tsx`, `app-breadcrumb.tsx`, `command-palette.tsx`, the `app-shell.tsx` wiring) has a task. The doc-update task closes the loop.

**2. Placeholder scan.** No TBD/TODO markers. Every code block is the complete file or the complete diff, not a description of one — `command-palette.tsx`'s full adapted source is written out in Task 2, not summarized.

**3. Type consistency.** `CommandPalette()`/`AppBreadcrumb()` are both zero-prop components in every task that defines or consumes them. `NAV_GROUPS`/`PALETTE_QUICK_ACTIONS` are the same names and shapes Task 2 imports as already exist in `@/lib/nav-items`/`@/lib/quick-actions` — unchanged by this plan.

## Verification

No local test runs — per Global Constraints and this session's standing rule, `git push` + `gh pr checks <n>` (or `gh pr checks <n> --watch`) is what this plan reports pass/fail against, and only `Lint · Typecheck`/`Build` failures are this plan's responsibility to fix; `Test (coverage)`/`E2E` fallout from the new header children is logged in the status doc, not chased here.
