/**
 * Tenant-subdomain parsing for the dashboard login flow.
 *
 * Deliberately a separate, smaller copy of apps/website/src/lib/host.ts rather than a
 * shared import — this repo's own convention keeps each app's `lib/` self-contained (see
 * PLATFORM_NAME in apps/website vs. apps/dashboard). The dashboard has no "custom domain"
 * concept: tenants get a custom domain for their public site only, never for staff login.
 *
 * Tenant hosts live under `app.<platform_domain>`, NOT bare `<platform_domain>` — e.g.
 * `cityschool.app.schoolhub.example`, not `cityschool.schoolhub.example`. That's a
 * deliberate, different wildcard from the website's own `<slug>.<platform_domain>`: the
 * two apps can't both claim the same wildcard (infra/terraform/envs/production/main.tf's
 * comment on the website's ALB rule explains why — a shared wildcard would make one
 * service's host rule swallow the other's traffic). Reserving the `app.` prefix for the
 * dashboard is what lets its own ALB rule (`module "dashboard"`, same Terraform file)
 * match tenant dashboard hosts before they'd otherwise fall through to the website's
 * wider rule.
 */

const PORT_SUFFIX_PATTERN = /:\d+$/;

/** `<platform_domain>` alone is the website's apex/landing page — never a dashboard host. */
function dashboardApex(platformDomain: string): string {
  return `app.${platformDomain.trim().toLowerCase()}`;
}

/**
 * `demo.app.localhost` (platformDomain="localhost")  -> "demo"
 * `app.localhost`                                    -> null (generic login, no tenant)
 * `localhost` (bare, no "app." prefix)                -> null (local-dev convenience only;
 *                                                         production never routes this host
 *                                                         to the dashboard at all)
 * `a.b.app.localhost` (more than one label)            -> null (not a recognized tenant host)
 */
export function parseTenantSlug(hostname: string, platformDomain: string): string | null {
  const host = hostname.trim().toLowerCase().replace(PORT_SUFFIX_PATTERN, "");
  const apex = dashboardApex(platformDomain);

  if (host === apex) return null;
  if (!host.endsWith(`.${apex}`)) return null;

  const label = host.slice(0, -(apex.length + 1));
  if (label.length === 0 || label.includes(".")) return null;

  return label;
}
