/**
 * Tenant-subdomain parsing for the dashboard login flow.
 *
 * Deliberately a separate, smaller copy of apps/website/src/lib/host.ts rather than a
 * shared import — this repo's own convention keeps each app's `lib/` self-contained (see
 * PLATFORM_NAME in apps/website vs. apps/dashboard). The dashboard has no "custom domain"
 * concept: tenants get a custom domain for their public site only, never for staff login.
 */

const PORT_SUFFIX_PATTERN = /:\d+$/;

/** Subdomain labels that are the dashboard's own generic entry points, not a tenant. */
const GENERIC_LABELS = new Set(["app"]);

/**
 * `demo.localhost` (platformDomain="localhost")   -> "demo"
 * `localhost` / `app.localhost`                   -> null (generic login, no tenant)
 * `a.b.localhost` (more than one label)            -> null (not a recognized tenant host)
 */
export function parseTenantSlug(hostname: string, platformDomain: string): string | null {
  const host = hostname.trim().toLowerCase().replace(PORT_SUFFIX_PATTERN, "");
  const apex = platformDomain.trim().toLowerCase();

  if (host === apex) return null;
  if (!host.endsWith(`.${apex}`)) return null;

  const label = host.slice(0, -(apex.length + 1));
  if (label.length === 0 || label.includes(".") || GENERIC_LABELS.has(label)) return null;

  return label;
}
