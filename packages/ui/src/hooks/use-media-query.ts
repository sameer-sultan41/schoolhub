"use client";

import { useSyncExternalStore } from "react";

function subscribe(query: string, onChange: () => void): () => void {
  const mql = window.matchMedia(query);
  mql.addEventListener("change", onChange);
  return () => {
    mql.removeEventListener("change", onChange);
  };
}

/**
 * A single `matchMedia` query, `useSyncExternalStore`-backed so SSR and the first client
 * render never guess a viewport size they don't have — every breakpoint hook in this app
 * (`useIsMobile` here, `apps/dashboard`'s `useIsDesktopShell`) is this one query/subscribe
 * loop with a different query string and default polarity, so it lives here once instead
 * of being reimplemented per breakpoint.
 */
export function useMediaQuery(query: string, defaultValue: boolean): boolean {
  return useSyncExternalStore(
    (onChange) => subscribe(query, onChange),
    () => window.matchMedia(query).matches,
    () => defaultValue,
  );
}
