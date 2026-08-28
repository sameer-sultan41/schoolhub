import type { ResolvedTenantHost } from "@schoolhub/types";

/**
 * Pure Host-header parsing, shared by the proxy (edge runtime) and the server
 * components. No I/O, no env access — so it is trivially testable and safe at the edge.
 *
 * Tenant resolution is the security boundary of this app (website-builder.md §1): the
 * tenant comes from the Host header and nowhere else — never a query param, never a cookie.
 */

/** Lowercase, strip the port, strip a trailing dot. */
export function normalizeHost(rawHost: string | null | undefined): string | null {
  if (!rawHost) return null;
  const host = rawHost.trim().toLowerCase().split(",")[0]?.trim();
  if (!host) return null;
  const withoutPort = host.replace(/:\d+$/, "").replace(/\.$/, "");
  // Reject anything that is not a plausible hostname before it reaches an API URL.
  if (!/^[a-z0-9.-]+$/.test(withoutPort)) return null;
  return withoutPort;
}

const RESERVED_LABELS = new Set([
  "www",
  "api",
  "app",
  "admin",
  "dashboard",
  "static",
  "cdn",
  "mail",
  "status",
]);

/**
 * Classify a host as a platform wildcard subdomain or a custom domain.
 *
 * `cityschool.schoolhub.pk`  → `{ kind: "subdomain", slug: "cityschool" }`
 * `www.cityschool.edu.pk`    → `{ kind: "custom-domain" }`
 * `schoolhub.pk` / `www.…`   → `null` (the platform's own landing page, not a tenant)
 */
export function parseHost(
  rawHost: string | null | undefined,
  platformDomain: string,
): ResolvedTenantHost | null {
  const host = normalizeHost(rawHost);
  if (!host) return null;

  const apex = platformDomain.trim().toLowerCase();

  if (host === apex) return null;

  if (host.endsWith(`.${apex}`)) {
    const label = host.slice(0, -(apex.length + 1));
    // Only a single label is a tenant slug; deeper nesting is not a tenant site.
    if (label.length === 0 || label.includes(".")) return null;
    if (RESERVED_LABELS.has(label)) return null;
    return { kind: "subdomain", host, slug: label };
  }

  // Anything else is a candidate custom domain — the API decides whether it is verified.
  return { kind: "custom-domain", host };
}

/** Header the proxy sets after resolving the host; client-supplied copies are stripped. */
export const TENANT_HOST_HEADER = "x-schoolhub-host";
export const TENANT_SLUG_HEADER = "x-schoolhub-tenant-slug";
export const TENANT_KIND_HEADER = "x-schoolhub-host-kind";
