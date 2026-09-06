"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useTransition } from "react";

type ParamUpdates = Record<string, string | null>;

/**
 * Reads and writes the table state that belongs in the URL.
 *
 * Filters, sort and page size live here rather than in `useState` so a filtered view is
 * a link: it can be shared with a colleague, bookmarked, and reached again with the
 * back button. This is the convention the LinkedUnion dashboard uses for every one of
 * its tables, and the reason its screens survive a refresh with the reader's work
 * intact.
 *
 * A null value deletes the key rather than writing an empty one, so a cleared filter
 * leaves the URL as short as it was before the reader touched it.
 *
 * `startTransition` keeps the current rows on screen while the next page resolves —
 * without it the table would unmount into its skeleton on every sort click. `isPending`
 * is what a caller shows a busy state from.
 *
 * NOT for the cursor. A cursor token is minted against one exact filter combination and
 * means nothing under another, so a shared link carrying one would point at a page that
 * may no longer exist; the cursor stays in React state and resets when these params
 * change (see `useCursorPager.syncFilterKey`).
 */
export function useSearchParam() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // The query string we last WROTE, held until the router reports it back.
  //
  // `router.replace` is asynchronous, and `searchParams` is a render-time snapshot, so
  // two updates fired before the next render both build on the same stale base and the
  // second silently drops the first. That is not a corner case: the column menu stays
  // open precisely so several columns can be ticked in a row, and every tick but the
  // last was being lost. Reading from what we last wrote makes a burst of updates
  // compose instead of overwrite.
  const pendingSearch = useRef<string | null>(null);

  // The router has caught up — the snapshot is authoritative again. Clearing rather
  // than comparing: a value that arrived from anywhere else (Back, a link, another
  // component) should win over what this hook remembers writing.
  useEffect(() => {
    pendingSearch.current = null;
  }, [searchParams]);

  const updateParams = useCallback(
    (updates: ParamUpdates) => {
      const params = new URLSearchParams(pendingSearch.current ?? searchParams.toString());

      for (const [key, value] of Object.entries(updates)) {
        if (value === null) params.delete(key);
        else params.set(key, value);
      }

      const next = params.toString();
      pendingSearch.current = next;

      startTransition(() => {
        // replace, not push: a sort click is a refinement of the view the reader is
        // already looking at, not a new place. Pushing would make Back walk them
        // through every filter keystroke before leaving the screen.
        router.replace(`?${next}`, { scroll: false });
      });
    },
    [searchParams, router],
  );

  return { searchParams, updateParams, isPending };
}
