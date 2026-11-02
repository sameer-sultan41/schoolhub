"use client";

import { useCallback, useState } from "react";

const NO_CURSORS: readonly string[] = [];

/**
 * Where a cursor-paginated list is: the cursors of the pages it has moved past, so Previous can
 * return to one (the API's `previous_cursor` is not needed). Empty means the first page.
 *
 * `resetKey` names the query the stack belongs to (its filters and sort): when it changes the
 * stack is dropped, because a cursor is only valid for the query that issued it.
 */
export function useCursorStack(resetKey: string) {
  const [state, setState] = useState({ key: resetKey, cursors: NO_CURSORS });
  if (state.key !== resetKey) setState({ key: resetKey, cursors: NO_CURSORS });
  const cursors = state.key === resetKey ? state.cursors : NO_CURSORS;

  const goNext = useCallback(
    (cursor: string) => {
      setState((current) => ({
        key: resetKey,
        cursors: current.key === resetKey ? [...current.cursors, cursor] : [cursor],
      }));
    },
    [resetKey],
  );
  const goPrevious = useCallback(() => {
    setState((current) => ({
      key: resetKey,
      cursors: current.key === resetKey ? current.cursors.slice(0, -1) : NO_CURSORS,
    }));
  }, [resetKey]);
  const reset = useCallback(() => {
    setState({ key: resetKey, cursors: NO_CURSORS });
  }, [resetKey]);

  return {
    /** The cursor of the page to read; `undefined` for the first page. */
    cursor: cursors[cursors.length - 1],
    hasPrevious: cursors.length > 0,
    goNext,
    goPrevious,
    reset,
  };
}
