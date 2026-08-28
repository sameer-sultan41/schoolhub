import type { Metadata } from "next";
import { RenderPage, renderPageMetadata } from "./render-page";

/**
 * Homepage. A catch-all route does not match `/`, so the root has its own entry point
 * into the same renderer.
 *
 * ISR: rendered on first request, cached at the edge, revalidated on a modest TTL as a
 * safety net. Real freshness comes from the publish webhook invalidating the tenant's
 * cache tags (website-builder.md §3).
 */
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  return renderPageMetadata([]);
}

export default async function HomePage() {
  return <RenderPage segments={[]} />;
}
