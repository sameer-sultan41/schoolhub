"use client";

import { useEffect, useState } from "react";

/**
 * Returns `value`, delayed by `delayMs` of no further changes — the standard pattern for
 * a search input whose own field must update every keystroke while the query it drives
 * only fires once typing pauses. Previously inlined per call site (one `useState` +
 * `useEffect`/`setTimeout` pair each); this is the shared version other screens should
 * reach for before re-inlining it again.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      clearTimeout(handle);
    };
  }, [value, delayMs]);

  return debounced;
}
