"use client";

import { useSyncExternalStore } from "react";

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
 * The safe default matters as much as the threshold: `useSyncExternalStore`'s
 * `getServerSnapshot` (`() => false`) is also the value React keeps showing until it
 * gets around to re-checking `getSnapshot` after hydration, which in practice can be
 * long enough for a still-mounted phone or tablet browser to never visibly correct.
 * Framed as `isDesktopShell` rather than `isMobile`, that same "false" default means
 * "not desktop yet" — safe for the phone/tablet widths this bug actually hit — instead
 * of "not mobile yet", which was silently wrong for exactly those widths.
 */
const DESKTOP_SHELL_BREAKPOINT_PX = 1024;

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(`(min-width: ${DESKTOP_SHELL_BREAKPOINT_PX}px)`);
  mql.addEventListener("change", onChange);
  return () => {
    mql.removeEventListener("change", onChange);
  };
}

function getSnapshot(): boolean {
  return window.matchMedia(`(min-width: ${DESKTOP_SHELL_BREAKPOINT_PX}px)`).matches;
}

export function useIsDesktopShell(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
