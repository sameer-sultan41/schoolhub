import type { MetadataRoute } from "next";
import { canonicalOrigin, getRequestHost, resolveTenant } from "@/lib/tenant";

/**
 * Per-host robots.txt. Unknown and suspended sites emit a blanket disallow so an offline
 * or unclaimed site is never indexed (website-builder.md §4).
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const resolution = await resolveTenant();

  if (resolution.status !== "active") {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  const host = (await getRequestHost()) ?? resolution.tenant.slug;
  const origin = canonicalOrigin(resolution.tenant, host);

  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
