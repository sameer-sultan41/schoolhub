"use client";

import { useSearchParams } from "next/navigation";

/** Keys to set; `null` deletes the key. */
export type UrlParamUpdates = Record<string, string | null>;

/**
 * Applies `updates` to the current query string in place, without a new history entry.
 *
 * `window.history.replaceState`, not `router.replace`: Next keeps `useSearchParams` in
 * sync with it (the History API section of its linking-and-navigating guide) without
 * fetching the page from the server again, so a sort click doesn't wait on a round trip
 * and the query, search text included, never reaches the Next server's logs.
 *
 * Reads `window.location.search`, not the render's `searchParams`, so several writes in
 * the same tick build on each other instead of the last one winning.
 */
function writeUrlParams(updates: UrlParamUpdates): void {
  const params = new URLSearchParams(window.location.search);
  const before = params.toString();
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  if (query === before) return;
  const { pathname, hash } = window.location;
  window.history.replaceState(null, "", `${pathname}${query ? `?${query}` : ""}${hash}`);
}

/** The current query string, and an in-place writer for it (see `writeUrlParams`). */
export function useUrlParams() {
  const searchParams = useSearchParams();
  return { searchParams, setParams: writeUrlParams };
}
