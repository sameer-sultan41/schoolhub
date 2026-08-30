import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import type * as EnMessages from "../../messages/en.json";
import { env, isSupportedLocale } from "@/lib/env";

/** The shape every locale file under `messages/` is expected to match. */
type Messages = typeof EnMessages;

/**
 * next-intl without locale routing: the dashboard is a single-origin app whose language
 * follows the user/tenant preference, not the URL. The locale cookie is written after
 * sign-in from the authenticated user's `locale`.
 */
export const LOCALE_COOKIE_NAME = "sh_locale";

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const requested = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale =
    requested && isSupportedLocale(requested) ? requested : env.NEXT_PUBLIC_DEFAULT_LOCALE;

  // A dynamic import with a computed specifier can't be resolved statically, so TS gives
  // it type `any` — asserted against en.json's shape, the canonical structure every other
  // locale file is expected to match. Cast the whole module object before touching
  // `.default`, not after: asserting only the final expression still leaves the
  // intermediate `.default` access unsafely typed as `any`.
  const messages = (await import(`../../messages/${locale}.json`)) as { default: Messages };

  return {
    locale,
    messages: messages.default,
    // Tenant timezone would be injected here once the tenant is resolved server-side.
    now: new Date(),
  };
});
