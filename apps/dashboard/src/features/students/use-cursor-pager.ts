import type { CursorPagination } from "@schoolhub/types";
import { useState } from "react";

/**
 * Holds a cursor pager's state: `useQuery` + a cursor stack, not
 * `useInfiniteQuery`. DataTable's `pagination` prop is a page-REPLACEMENT
 * pager (hasNext/hasPrevious/onNext/onPrevious), not an append model, and
 * `packages/api-client`'s pagination helpers export `getNextPageParam` but no
 * previous-page counterpart — the shape useInfiniteQuery wants isn't what this
 * screen needs. Putting the cursor in the query-key params instead means each
 * page is its own cache entry under the normal staleTime/gcTime, so Previous
 * is an instant cache hit, not a refetch.
 */
export function useCursorPager() {
  const [cursor, setCursor] = useState<string | null>(null);
  const [stack, setStack] = useState<string[]>([]);
  // "" is a valid stack entry meaning "the first page" — see onPrevious.
  const [filterKey, setFilterKey] = useState<string | null>(null);

  function onNext(pagination: CursorPagination | undefined) {
    if (!pagination?.next_cursor) return;
    setStack((prev) => [...prev, cursor ?? ""]);
    setCursor(pagination.next_cursor);
  }

  function onPrevious() {
    setStack((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      const target = prev.at(-1) ?? "";
      setCursor(target || null);
      return next;
    });
  }

  /**
   * Reset the cursor when the filter set changes — a cursor minted under one
   * filter combination is meaningless (and may 404 or silently misbehave)
   * under another. React's "adjust state during render" pattern: no effect,
   * no extra commit, no flash of a stale page.
   */
  function syncFilterKey(nextFilterKey: string) {
    if (nextFilterKey !== filterKey) {
      setFilterKey(nextFilterKey);
      setCursor(null);
      setStack([]);
    }
  }

  return {
    cursor,
    hasPrevious: stack.length > 0,
    onNext,
    onPrevious,
    syncFilterKey,
  };
}
