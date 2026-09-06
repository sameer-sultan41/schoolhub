import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE_NAME } from "@/lib/constants";
import { cookies } from "next/headers";
import type * as EnMessages from "../../messages/en.json";
import { env, isSupportedLocale } from "@/lib/env";

/** The shape every locale file under `messages/` is expected to match. */
type Messages = typeof EnMessages;

/**
 * next-intl without locale routing: the dashboard is a single-origin app whose language
 * follows the user/tenant preference, not the URL.
 *
 * The cookie is written by the account menu's language switch
 * (`components/user-menu.tsx`). Writing it from the authenticated user's own `locale` at
 * sign-in is still to be done — until then a returning user gets the default until they
 * choose, which is why the switch exists at all.
 */
// Re-exported, not redeclared: the name is owned by `lib/constants.ts` so a client
// component can import it too (this module is server-only, via `next/headers`).
// Existing importers of this path keep working.
export { LOCALE_COOKIE_NAME };

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const requested = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale =
    requested && isSupportedLocale(requested) ? requested : env.NEXT_PUBLIC_DEFAULT_LOCALE;

  // A dynamic import with a computed specifier can't be resolved statically, so TS gives
  // it type `any` — asserted against en.json's shape. This assertion only describes *this*
  // value; it does not check any other locale file's real content — that check lives in
  // messages.types-check.ts, a file that exists purely to fail `tsc` if a locale diverges.
  // Cast the whole module object before touching `.default`, not after: asserting only
  // the final expression still leaves the intermediate `.default` access unsafely typed
  // as `any`.
  const messages = (await import(`../../messages/${locale}.json`)) as { default: Messages };

  return {
    locale,
    messages: messages.default,
    // Tenant timezone would be injected here once the tenant is resolved server-side.
    now: new Date(),
  };
});
