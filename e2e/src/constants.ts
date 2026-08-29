/**
 * Values duplicated from the apps under test.
 *
 * They are copied rather than imported: the apps are not published packages, and
 * reaching into `apps/dashboard/src` from here would couple the suite to an app's
 * internal layout. Each one is covered by a behavioural spec, so drift fails a test
 * rather than passing silently.
 */

/** `SESSION_COOKIE_NAME` in `apps/dashboard/src/lib/auth.ts`. Read by the auth proxy. */
export const SESSION_COOKIE_NAME = "sh_session";

/** Tenant headers set by the website proxy — `apps/website/src/lib/host.ts`. */
export const TENANT_HOST_HEADER = "x-schoolhub-tenant-host";
export const TENANT_SLUG_HEADER = "x-schoolhub-tenant-slug";
export const TENANT_KIND_HEADER = "x-schoolhub-tenant-kind";
