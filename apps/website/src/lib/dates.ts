import type { ApiSchemas } from "@schoolhub/api-client";

/** Dates in the school's own locale and time zone, never the server's. */
export function schoolDateFormatter(
  locale: ApiSchemas["PublicTenantLocale"],
  { withTime = false }: { withTime?: boolean } = {},
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale.default_locale, {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
    timeZone: locale.timezone,
  });
}
