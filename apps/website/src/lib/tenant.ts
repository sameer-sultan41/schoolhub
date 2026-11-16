import type { ApiSchemas } from "@schoolhub/api-client";
import { headers } from "next/headers";
import { cache } from "react";
import { readJson } from "./api";
import { TENANT_HOST_HEADER, TENANT_KIND_HEADER, TENANT_PATH_HEADER } from "./host";

/**
 * Tenant resolution for server components (website-builder.md §1, §7).
 *
 * The host arrives from the proxy, which is the only writer of that header. Nothing
 * here accepts a tenant identifier from a query param, cookie, or client-supplied header.
 *
 * `cache()` dedupes the lookup within a single render pass; the fetch itself is cached under
 * the host's tags, which the API's revalidation webhook drops when the school's state changes.
 */

export type PublicTenant = ApiSchemas["PublicTenant"];

/**
 * - `active`: render the site.
 * - `unavailable`: a suspended school, or a site in maintenance or not yet published. The
 *   neutral notice renders, never content, and never indexed.
 * - `unknown`: no school (or one being provisioned or deprovisioned). Not found.
 */
export type TenantResolution =
  | { status: "active"; tenant: PublicTenant; host: string }
  | { status: "unavailable"; tenant: PublicTenant; host: string }
  | { status: "unknown" };

/** How a resolved school's site is shown. Draft mode (preview) still renders a site that is not live. */
export function classifyTenant(
  tenant: PublicTenant,
  options: { draft: boolean } = { draft: false },
): TenantResolution["status"] {
  if (tenant.status === "deprovisioned" || tenant.status === "provisioning") return "unknown";
  if (tenant.status === "suspended") return "unavailable";
  if (tenant.website_status !== "live" && !options.draft) return "unavailable";
  return "active";
}

/** The host the proxy resolved for this request. */
export const getRequestHost = cache(async (): Promise<string | null> => {
  const headerList = await headers();
  return headerList.get(TENANT_HOST_HEADER);
});

export const resolveTenant = cache(async (): Promise<TenantResolution> => {
  const host = await getRequestHost();
  if (!host) return { status: "unknown" };

  // The API matches the host against the tenant slug and the active custom-domain routes.
  const tenant = await readJson<PublicTenant>("/public/tenants/by-host", {
    host,
    // Host→tenant mappings change rarely; settings and domain changes invalidate these tags.
    revalidate: 300,
    tags: ["tenant-hosts", `tenant-host:${host}`],
  });

  if (!tenant) return { status: "unknown" };
  // Draft mode (preview) is wired by the preview route; until then no request is a draft.
  const status = classifyTenant(tenant);
  if (status === "unknown") return { status };
  return { status, tenant, host };
});

/**
 * Where a platform-subdomain request must permanently redirect, or null (website-builder §4):
 * the school's primary custom domain, keeping the path and query. Custom-domain requests and
 * schools without one never redirect.
 */
export async function customDomainRedirectTarget(
  resolution: TenantResolution,
): Promise<string | null> {
  if (resolution.status !== "active") return null;
  const domain = resolution.tenant.custom_domain?.toLowerCase();
  if (!domain || domain === resolution.host) return null;

  const headerList = await headers();
  if (headerList.get(TENANT_KIND_HEADER) !== "subdomain") return null;

  const path = headerList.get(TENANT_PATH_HEADER) ?? "/";
  // Concatenated, never resolved with `new URL(path, base)`: a `//evil.example` path would
  // otherwise replace the host. Here it stays a path on the school's own domain.
  return `https://${domain}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Canonical origin for SEO: an active custom domain wins, otherwise the platform subdomain
 * (website-builder.md §4 — the subdomain 301-redirects to the custom domain when set).
 */
export function canonicalOrigin(tenant: PublicTenant, fallbackHost: string): string {
  const host = tenant.custom_domain ?? fallbackHost;
  return `https://${host}`;
}
