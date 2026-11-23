import type { MetadataRoute } from "next";
import { canonicalOrigin, resolveTenant } from "@/lib/tenant";

/**
 * Per-host robots.txt. Unknown, suspended, unpublished and maintenance sites emit a blanket
 * disallow so an offline or unclaimed site is never indexed (website-builder.md §4).
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const resolution = await resolveTenant();

  if (resolution.status !== "active") {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  const origin = canonicalOrigin(resolution.tenant, resolution.host);

  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
