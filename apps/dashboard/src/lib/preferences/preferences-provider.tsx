"use client";

import { createContext, type ReactNode, useContext, useState } from "react";
import { useStore } from "zustand";
import type { PreferenceKey, PreferenceValues } from "./preferences-config";
import {
  createPreferencesStore,
  type PreferencesState,
  type PreferencesStore,
} from "./preferences-store";

const PreferencesContext = createContext<PreferencesStore | null>(null);

/**
 * `initialValues` comes from the server's own cookie read, so the first client render
 * already agrees with the `<html data-*>` attributes the server stamped. There is no
 * hydration gap to paper over and no "synced yet?" flag — the template this is adapted
 * from needs one only because its root layout is static; ours already reads a cookie for
 * the locale, so it can read these too.
 */
export function PreferencesProvider({
  initialValues,
  children,
}: {
  initialValues: PreferenceValues;
  children: ReactNode;
}) {
  const [store] = useState(() => createPreferencesStore(initialValues));
  return <PreferencesContext.Provider value={store}>{children}</PreferencesContext.Provider>;
}

function usePreferencesStore<T>(selector: (state: PreferencesState) => T): T {
  const store = useContext(PreferencesContext);
  if (!store) {
    throw new Error("usePreference must be used inside <PreferencesProvider>.");
  }
  return useStore(store, selector);
}

/**
 * One preference value.
 *
 * Selecting a single key rather than the whole `values` object keeps a control from
 * re-rendering every time some other preference changes.
 */
export function usePreference<K extends PreferenceKey>(key: K): PreferenceValues[K] {
  return usePreferencesStore((state) => state.values[key]);
}

export function usePreferenceActions(): Pick<
  PreferencesState,
  "setPreference" | "resetPreferences"
> {
  const setPreference = usePreferencesStore((state) => state.setPreference);
  const resetPreferences = usePreferencesStore((state) => state.resetPreferences);
  return { setPreference, resetPreferences };
}
