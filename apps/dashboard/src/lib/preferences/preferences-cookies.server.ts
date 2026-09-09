import { cookies } from "next/headers";
import { PREFERENCE_KEYS, type PreferenceValues, parsePreference } from "./preferences-config";

/**
 * Server-side half of the preference cookies.
 *
 * Split from the client half rather than kept in one module with it: `next/headers` is
 * server-only, and the client store imports the writer. A single file put both on the
 * same import chain, and the whole app 500'd with "You're importing a module that depends
 * on next/headers" — the bundler follows the module, not the function.
 */
export async function readPreferencesFromCookies(): Promise<PreferenceValues> {
  const store = await cookies();
  return Object.fromEntries(
    PREFERENCE_KEYS.map((key) => [key, parsePreference(key, store.get(key)?.value)]),
  ) as PreferenceValues;
}
