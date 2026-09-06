import type { PreferenceKey, PreferenceValues } from "./preferences-config";

/** A year: a layout choice is not something a viewer expects to re-make every week. */
const PREFERENCE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Write one preference from the browser.
 *
 * A plain document.cookie rather than a Server Action: these are display choices with no
 * server-side effect, and a round trip per toggle would make the segmented controls feel
 * like form submissions. Not HttpOnly for the same reason — nothing here is a secret, and
 * the store reads its own writes back. SameSite=Lax so it still travels on the top-level
 * navigation that renders the layout.
 *
 * The read side lives in preferences-cookies.server.ts; see the note there for why the
 * two halves must not share a module.
 */
export function writePreferenceCookie<K extends PreferenceKey>(
  key: K,
  value: PreferenceValues[K],
): void {
  document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=${PREFERENCE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}
