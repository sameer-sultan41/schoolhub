import { cookies } from "next/headers";
import {
  PREFERENCE_KEYS,
  type PreferenceKey,
  type PreferenceValues,
  parsePreference,
} from "./preferences-config";

/** A year: a layout choice is not something a viewer expects to re-make every week. */
const PREFERENCE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Read every preference server-side.
 *
 * Called from the root layout (to stamp `<html>`) and from (app)/layout.tsx (so the
 * sidebar's variant and open state are already right on the server render, instead of
 * snapping into place on hydration). Next dedupes `cookies()` within a request, so the
 * two call sites cost one read.
 */
export async function readPreferencesFromCookies(): Promise<PreferenceValues> {
  const store = await cookies();
  return Object.fromEntries(
    PREFERENCE_KEYS.map((key) => [key, parsePreference(key, store.get(key)?.value)]),
  ) as PreferenceValues;
}

/**
 * Write one preference from the browser.
 *
 * A plain document.cookie rather than a Server Action: these are display choices with no
 * server-side effect, and a round trip per toggle would make the segmented controls feel
 * like form submissions. Not HttpOnly for the same reason — nothing here is a secret, and
 * the store reads its own writes back. SameSite=Lax so it still travels on the top-level
 * navigation that renders the layout.
 */
export function writePreferenceCookie<K extends PreferenceKey>(
  key: K,
  value: PreferenceValues[K],
): void {
  document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=${PREFERENCE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}
