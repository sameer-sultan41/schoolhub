"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

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

  const updateParams = useCallback(
    (updates: ParamUpdates) => {
      const params = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(updates)) {
        if (value === null) params.delete(key);
        else params.set(key, value);
      }

      startTransition(() => {
        // replace, not push: a sort click is a refinement of the view the reader is
        // already looking at, not a new place. Pushing would make Back walk them
        // through every filter keystroke before leaving the screen.
        router.replace(`?${params.toString()}`, { scroll: false });
      });
    },
    [searchParams, router],
  );

  return { searchParams, updateParams, isPending };
}
