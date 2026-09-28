"use client";

import { useCallback, useSyncExternalStore } from "react";

// Writes happen only through this module (the `storage` event never fires in the tab
// that made the change, and sessionStorage is per-tab anyway), so a module-level
// listener set is the whole subscription story.
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readItem(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string | null): void {
  try {
    if (value === null) {
      window.sessionStorage.removeItem(key);
    } else {
      window.sessionStorage.setItem(key, value);
    }
  } catch {
    // Storage blocked or full: the value just doesn't persist past this mount.
  }
  for (const listener of listeners) listener();
}

/**
 * A string kept in `sessionStorage` under `key` — per tab, so it survives a remount, a
 * client-side navigation and a reload, and is gone once the tab closes. Reads `null`
 * while `key` is null, during server rendering (so hydration never mismatches), and
 * wherever storage is unavailable; writes are then no-ops, never a throw — callers
 * that need the value within one mount regardless should keep their own state too.
 */
export function useSessionStorageState(
  key: string | null,
): [string | null, (value: string | null) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => (key === null ? null : readItem(key)),
    () => null,
  );
  const setValue = useCallback(
    (next: string | null) => {
      if (key !== null) writeItem(key, next);
    },
    [key],
  );
  return [value, setValue];
}
