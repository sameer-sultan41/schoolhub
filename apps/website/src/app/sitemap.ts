import type { MetadataRoute } from "next";
import { getPublishedPaths } from "@/lib/content";
import { canonicalOrigin, getRequestHost, resolveTenant } from "@/lib/tenant";

/**
 * Per-tenant sitemap generated from published pages, on the canonical host
 * (the custom domain when one is active).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const resolution = await resolveTenant();
  if (resolution.status !== "active") return [];

  const tenant = resolution.tenant;
  const host = (await getRequestHost()) ?? tenant.slug;
  const origin = canonicalOrigin(tenant, host);
  const entries = await getPublishedPaths(tenant.id);

  return entries.map((entry) => ({
    url: `${origin}${entry.path.startsWith("/") ? entry.path : `/${entry.path}`}`,
    lastModified: new Date(entry.updated_at),
  }));
}
