import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { env, isSupportedLocale } from "@/lib/env";

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

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    // Tenant timezone would be injected here once the tenant is resolved server-side.
    now: new Date(),
  };
});
