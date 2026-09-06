"use client";

import { useEffect, useRef, useState } from "react";
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants";

export interface DebouncedValue {
  /** Bind this to the input. It changes on every keystroke, so typing never lags. */
  draft: string;
  /** What the draft has settled to — the value that belongs in a query key. */
  settled: string;
  /** A keystroke: shows at once, settles once the window passes without another. */
  onDraftChange: (next: string) => void;
  /**
   * Settle on `next` now, dropping a window still open.
   *
   * Every caller that reaches for this — clearing a filter row, resetting a dialog as it
   * closes, adopting a value its parent just changed — is setting something newer than
   * whatever was being typed toward. Letting the pending settle land afterwards would put
   * a stale term back over it, which is the bug the guardian dialog's own `reset()` had.
   */
  set: (next: string) => void;
}

/**
 * A search box's two values: the one being typed, and the one worth asking the server about.
 *
 * `FilterBar` was introduced so that list screens would stop hand-rolling a `useRef` timer
 * each — and then the guardian-link dialog grew one anyway, because it is a dialog rather
 * than a filter row and bending it through `FilterBar` would have been the wrong fix. What
 * the two genuinely share is this: the timer, not the markup.
 *
 * `onSettle` is read from the render the keystroke happened in, deliberately — the callback
 * a caller passes closes over that render's props, which is what a caller reading its own
 * `onChange` off props expects.
 */
export function useDebouncedValue(
  initialValue = "",
  options: { delayMs?: number; onSettle?: (value: string) => void } = {},
): DebouncedValue {
  const { delayMs = SEARCH_DEBOUNCE_MS, onSettle } = options;
  const [draft, setDraft] = useState(initialValue);
  const [settled, setSettled] = useState(initialValue);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Unmounting mid-window — a dialog closed, a screen navigated away from — must not leave
  // a timer that fires into a component that is gone.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function onDraftChange(next: string) {
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSettled(next);
      onSettle?.(next);
    }, delayMs);
  }

  function set(next: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setDraft(next);
    setSettled(next);
  }

  return { draft, settled, onDraftChange, set };
}
