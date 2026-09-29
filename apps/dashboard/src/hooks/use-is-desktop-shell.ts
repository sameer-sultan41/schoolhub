"use client";

import { useMediaQuery } from "@schoolhub/ui";

/**
 * True at and above the shell's docked-sidebar breakpoint — `demo1.css`'s
 * `@media (min-width: theme(--breakpoint-lg))` gate on `.sidebar-fixed` (Tailwind's
 * `lg`, 1024px). Deliberately not `@schoolhub/ui`'s `useIsMobile` (768px): that hook is
 * shadcn's own generic `Sidebar` breakpoint, unrelated to this app's Metronic shell, and
 * using it here left a 768–1023px gap where `Shell`/`Header` rendered the desktop
 * chrome (matching `!isMobile`) but the CSS above hadn't started fixed-positioning it
 * yet — the sidebar rendered in normal flow, full height, shoving the page's real
 * content down behind it.
 *
 * The safe default matters too, independent of the breakpoint fix above: `false` is
 * also what renders before the first client measurement. Framed as `isDesktopShell`
 * rather than `isMobile`, that "false" default means "not desktop yet" — safe for the
 * narrower widths this bug actually hit — instead of "not mobile yet" (`useIsMobile`'s
 * framing), which defaults toward assuming desktop on exactly the widths that were
 * broken.
 *
 * This is also the breakpoint `apps/dashboard/src/components/responsive-dialog.tsx`
 * uses to decide Dialog/Sheet vs. Drawer, for the same reason: at 768–1023px the shell
 * already renders mobile-style chrome (this hook says so), so a dialog choosing its
 * primitive off `useIsMobile()` (768px) instead would show a centered desktop Dialog
 * inside what the user is otherwise looking at as a mobile layout.
 */
const DESKTOP_SHELL_BREAKPOINT_PX = 1024;

export function useIsDesktopShell(): boolean {
  return useMediaQuery(`(min-width: ${DESKTOP_SHELL_BREAKPOINT_PX}px)`, false);
}
