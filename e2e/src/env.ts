import { z } from "zod";

/**
 * E2E configuration, validated once at load.
 *
 * Mirrors the pattern in `apps/dashboard/src/lib/env.ts`: fail loudly at boot rather
 * than with a confusing timeout on the first `page.goto`. Every value has a local
 * default so `pnpm e2e` works on a fresh clone with no `.env` file.
 */
const schema = z.object({
  /** Dashboard origin under test. */
  DASHBOARD_URL: z.url().default("http://localhost:3000"),
  /** Website origin under test. */
  WEBSITE_URL: z.url().default("http://localhost:3001"),
  /**
   * API origin the apps are pointed at.
   *
   * In the mocked lane nothing listens here on purpose: an un-stubbed request fails
   * loudly instead of silently reaching a real service. The live lane overrides it.
   */
  API_BASE_URL: z.url().default("http://127.0.0.1:4010/api/v1"),
  /** Apex domain the website resolves `<slug>.<domain>` against. */
  PLATFORM_DOMAIN: z.string().min(1).default("localhost"),

  // ---- Live lane only. Unused by the mocked projects. ----
  LIVE_TENANT_SLUG: z.string().min(1).default("e2e-school"),
  LIVE_ADMIN_IDENTIFIER: z.string().min(1).default("e2e-admin@schoolhub.test"),
  LIVE_ADMIN_PASSWORD: z.string().min(1).default("e2e-not-a-real-password"),
  /** A second tenant, used to prove cross-tenant reads return 404 and never 403. */
  LIVE_OTHER_TENANT_SLUG: z.string().min(1).default("e2e-other-school"),
});

const parsed = schema.safeParse({
  DASHBOARD_URL: process.env.E2E_DASHBOARD_URL,
  WEBSITE_URL: process.env.E2E_WEBSITE_URL,
  API_BASE_URL: process.env.E2E_API_BASE_URL,
  PLATFORM_DOMAIN: process.env.E2E_PLATFORM_DOMAIN,
  LIVE_TENANT_SLUG: process.env.E2E_LIVE_TENANT_SLUG,
  LIVE_ADMIN_IDENTIFIER: process.env.E2E_LIVE_ADMIN_IDENTIFIER,
  LIVE_ADMIN_PASSWORD: process.env.E2E_LIVE_ADMIN_PASSWORD,
  LIVE_OTHER_TENANT_SLUG: process.env.E2E_LIVE_OTHER_TENANT_SLUG,
});

if (!parsed.success) {
  throw new Error(`Invalid E2E configuration:\n${z.prettifyError(parsed.error)}`);
}

export const env = parsed.data;

/** Glob that matches every API call the apps make, for `page.route`. */
export const API_ROUTE_GLOB = `${new URL(env.API_BASE_URL).origin}/**`;

/** Path prefix (`/api/v1`) the mock router strips before matching. */
export const API_PATH_PREFIX = new URL(env.API_BASE_URL).pathname.replace(/\/$/, "");

/**
 * The dashboard's login/refresh/logout never call the API directly — they go through
 * this app's own same-origin proxy (apps/dashboard/next.config.ts's rewrites()), which
 * exists so the refresh cookie is never cross-site. That means those three calls land on
 * the *dashboard's* origin, not the API's, so they need their own `page.route` glob and
 * their own prefix strip — `/api/auth/login` normalizes to `/auth/login`, the same key
 * `authModule`'s stubs are already registered under, by stripping only `/api`.
 */
export const DASHBOARD_AUTH_PROXY_GLOB = `${new URL(env.DASHBOARD_URL).origin}/api/auth/**`;
export const DASHBOARD_AUTH_PROXY_PATH_PREFIX = "/api";

/** Host for a tenant's public site, e.g. `cityschool.localhost:3001`. */
export function tenantHost(slug: string): string {
  const website = new URL(env.WEBSITE_URL);
  return `${slug}.${env.PLATFORM_DOMAIN}${website.port ? `:${website.port}` : ""}`;
}

/** Full origin for a tenant's public site. */
export function tenantOrigin(slug: string): string {
  return `${new URL(env.WEBSITE_URL).protocol}//${tenantHost(slug)}`;
}
