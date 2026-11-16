import type { ApiSchemas } from "@schoolhub/api-client";
import { headers } from "next/headers";
import { cache } from "react";
import { hostTag, readJson } from "./api";
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

type ResolutionStatus = TenantResolution["status"];

/** `never` makes a missed enum member a compile error; at runtime an unexpected value fails closed. */
function unhandledStatus(_status: never): ResolutionStatus {
  return "unknown";
}

/** The school's lifecycle alone; a new `TenantStatusEnum` member fails `tsc` here. */
function statusOfSchool(status: PublicTenant["status"]): ResolutionStatus {
  switch (status) {
    case "deprovisioned":
    case "provisioning":
      return "unknown";
    case "suspended":
      return "unavailable";
    case "trial":
    case "active":
    case "past_due":
      return "active";
    default:
      return unhandledStatus(status);
  }
}

/** The site's own state; a new `WebsiteStatusEnum` member fails `tsc` here. */
function statusOfSite(status: PublicTenant["website_status"], draft: boolean): ResolutionStatus {
  switch (status) {
    case "live":
      return "active";
    case "maintenance":
    case "unpublished":
      return draft ? "active" : "unavailable";
    default:
      return unhandledStatus(status);
  }
}

/** How a resolved school's site is shown. Draft mode (preview) still renders a site that is not live. */
export function classifyTenant(
  tenant: PublicTenant,
  options: { draft: boolean } = { draft: false },
): ResolutionStatus {
  const school = statusOfSchool(tenant.status);
  if (school !== "active") return school;
  return statusOfSite(tenant.website_status, options.draft);
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
    tags: ["tenant-hosts", hostTag(host)],
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
