import type { Tenant } from "@schoolhub/types";
import { headers } from "next/headers";
import { cache } from "react";
import { readJson, tenantTag } from "./api";
import { TENANT_HOST_HEADER } from "./host";

/**
 * Tenant resolution for server components (website-builder.md §1, §7).
 *
 * The host arrives from the proxy, which is the only writer of that header. Nothing
 * here accepts a tenant identifier from a query param, cookie, or client-supplied header.
 *
 * `cache()` dedupes the lookup within a single render pass; the ISR entry itself is keyed
 * by (tenant, path) because the resolved tenant is part of the fetch's cache tags.
 */

export type TenantResolution =
  | { status: "active"; tenant: Tenant }
  | { status: "suspended"; tenant: Tenant }
  | { status: "unknown" };

/** The host the proxy resolved for this request. */
export const getRequestHost = cache(async (): Promise<string | null> => {
  const headerList = await headers();
  return headerList.get(TENANT_HOST_HEADER);
});

export const resolveTenant = cache(async (): Promise<TenantResolution> => {
  const host = await getRequestHost();
  if (!host) return { status: "unknown" };

  // The API matches the host against the tenant slug and the verified custom-domain table.
  const tenant = await readJson<Tenant>("/public/tenants/by-host", {
    query: { host },
    // Host→tenant mappings change rarely; domain verification invalidates this tag.
    revalidate: 300,
    tags: ["tenant-hosts", `tenant-host:${host}`],
  });

  if (!tenant) return { status: "unknown" };
  if (tenant.status === "suspended" || tenant.status === "closed") {
    return { status: "suspended", tenant };
  }
  return { status: "active", tenant };
});

/**
 * The active tenant, or null when the host is unknown/suspended.
 * Callers render `notFound()` or the neutral notice page rather than guessing.
 */
export async function getActiveTenant(): Promise<Tenant | null> {
  const resolution = await resolveTenant();
  return resolution.status === "active" ? resolution.tenant : null;
}

/** Cache tags every request for this tenant should carry. */
export async function tenantCacheTags(): Promise<string[]> {
  const tenant = await getActiveTenant();
  return tenant ? [tenantTag(tenant.id)] : [];
}

/**
 * Canonical origin for SEO: an active custom domain wins, otherwise the platform subdomain
 * (website-builder.md §4 — the subdomain 301-redirects to the custom domain when set).
 */
export function canonicalOrigin(tenant: Tenant, fallbackHost: string): string {
  const host = tenant.custom_domain ?? fallbackHost;
  return `https://${host}`;
}
