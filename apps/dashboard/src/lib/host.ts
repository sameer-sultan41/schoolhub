/**
 * Tenant-subdomain parsing for the dashboard login flow.
 *
 * Deliberately a separate, smaller copy of apps/website/src/lib/host.ts rather than a
 * shared import — this repo's own convention keeps each app's `lib/` self-contained (see
 * PLATFORM_NAME in apps/website vs. apps/dashboard). The dashboard has no "custom domain"
 * concept: tenants get a custom domain for their public site only, never for staff login.
 *
 * KNOWN GAP — this never activates in production today. The dashboard's ALB listener
 * rule (infra/terraform/envs/production/main.tf, `module "dashboard"`) only matches the
 * literal host `app.${platform_domain}`, not a wildcard, so `<slug>.<platform_domain>`
 * never reaches this app in production at all — it falls through to the *website*'s own
 * wildcard rule instead. Widening the dashboard's rule to a wildcard too isn't a safe
 * drop-in fix: that same Terraform file's own comment on the website's rule warns that a
 * wildcard placed carelessly relative to the other host rules "would route
 * api.schoolhub.example to the tenant website renderer and take the entire platform
 * down" — the two services can't both claim the same `*.<platform_domain>` pattern.
 * Making this feature work in production needs a real subdomain-scheme decision (e.g.
 * `<slug>.app.<platform_domain>` for the dashboard, distinct from the website's
 * `<slug>.<platform_domain>`), not a code-only change. Local dev works today because
 * both apps just bind separate ports on the same `*.localhost` wildcard.
 *
 * This also means the pre-existing "identifier valid at more than one school" case
 * (core/rbac/backends.py's AmbiguousPrincipal) still has no way to disambiguate in the
 * UI — there was no manual school field before this subdomain inference existed either,
 * and subdomain inference doesn't help until the production routing gap above is closed.
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
