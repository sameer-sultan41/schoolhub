/**
 * Values mirrored from the apps under test.
 *
 * They are copied rather than imported: the apps are not published packages, and reaching
 * into an app's own source tree from here would couple the suite to its internal layout.
 *
 * Nothing detects drift automatically — a wrong value here makes a spec assert against a
 * header the app never sets, which passes for the wrong reason. Re-check against the
 * source when touching these.
 */

/** `SESSION_COOKIE_NAME` in `apps/dashboard/src/lib/auth.ts`. Read by the auth proxy. */
export const SESSION_COOKIE_NAME = "sh_session";

/** `LOCALE_COOKIE_NAME` in `apps/dashboard/src/i18n/request.ts`. Read to pick `dir`/locale. */
export const LOCALE_COOKIE_NAME = "sh_locale";

/** Tenant headers set by the website proxy — `apps/website/src/lib/host.ts` §65-67. */
export const TENANT_HOST_HEADER = "x-schoolhub-host";
export const TENANT_SLUG_HEADER = "x-schoolhub-tenant-slug";
export const TENANT_KIND_HEADER = "x-schoolhub-host-kind";
