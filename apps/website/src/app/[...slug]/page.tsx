import type { Metadata } from "next";
import { RenderPage, renderPageMetadata } from "../render-page";

interface RouteParams {
  params: Promise<{ slug: string[] }>;
}

/**
 * Every CMS page path (`/about`, `/admissions`, `/news/first-day`) renders through here.
 *
 * ISR per (tenant, path): the first request renders, the edge caches, and the TTL below is
 * only a safety net — a CMS publish fires the revalidation webhook
 * (`/api/revalidate`) which drops the affected tenant's cache tags immediately
 * (website-builder.md §3).
 */
export const revalidate = 300;

/**
 * Paths cannot be enumerated at build time: they belong to tenants resolved from the Host
 * header at request time. Pages are generated on demand and then cached.
 */
export const dynamicParams = true;

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { slug } = await params;
  return renderPageMetadata(slug);
}

export default async function CmsPage({ params }: RouteParams) {
  const { slug } = await params;
  return <RenderPage segments={slug} />;
}
