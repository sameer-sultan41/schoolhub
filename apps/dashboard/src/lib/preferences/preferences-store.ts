import { createStore } from "zustand/vanilla";
import {
  PREFERENCE_DEFAULTS,
  PREFERENCE_KEYS,
  PREFERENCE_REGISTRY,
  type PreferenceKey,
  type PreferenceValues,
} from "./preferences-config";
import { writePreferenceCookie } from "./preferences-cookies";

export interface PreferencesState {
  values: PreferenceValues;
  setPreference: <K extends PreferenceKey>(key: K, value: PreferenceValues[K]) => void;
  resetPreferences: () => void;
}

/**
 * Applying a preference is three writes that must not drift: the DOM attribute (so CSS
 * repaints now), the cookie (so the next server render agrees), and the store (so the
 * controls re-render). Doing them together in one place is the reason no caller ever
 * touches document.documentElement itself.
 */
function apply<K extends PreferenceKey>(key: K, value: PreferenceValues[K]): void {
  document.documentElement.setAttribute(PREFERENCE_REGISTRY[key].attribute, value);
  writePreferenceCookie(key, value);
}

export function createPreferencesStore(initialValues: PreferenceValues) {
  return createStore<PreferencesState>()((set) => ({
    values: initialValues,

    setPreference: (key, value) => {
      apply(key, value);
      set((state) => ({ values: { ...state.values, [key]: value } }));
    },

    resetPreferences: () => {
      for (const key of PREFERENCE_KEYS) {
        apply(key, PREFERENCE_DEFAULTS[key]);
      }
      set({ values: { ...PREFERENCE_DEFAULTS } });
    },
  }));
}

export type PreferencesStore = ReturnType<typeof createPreferencesStore>;
