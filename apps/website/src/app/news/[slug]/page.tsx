import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import {
  SiteChrome,
  UNAVAILABLE_METADATA,
  UnavailableNotice,
  missingContentMetadata,
  robotsFor,
} from "@/app/site-shell";
import { JsonLd } from "@/components/json-ld";
import { getNewsPost, getSite } from "@/lib/content";
import { schoolDateFormatter } from "@/lib/dates";
import { canonicalOrigin, resolveTenant } from "@/lib/tenant";
import { RichTextBlocks } from "@/themes/default/rich-text-blocks";

interface RouteParams {
  params: Promise<{ slug: string }>;
}

/** ISR per (tenant, slug); a publish fires the revalidation webhook (website-builder.md §3). */
export const revalidate = 300;
export const dynamicParams = true;

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { slug } = await params;
  const resolution = await resolveTenant();
  if (resolution.status !== "active") return UNAVAILABLE_METADATA;

  const { tenant, host } = resolution;
  const [post, site] = await Promise.all([
    getNewsPost(tenant.id, host, slug),
    getSite(tenant.id, host),
  ]);
  if (!post) return missingContentMetadata(tenant);

  const url = `${canonicalOrigin(tenant, host)}/news/${post.slug}`;
  const description = post.excerpt || undefined;
  return {
    title: post.title,
    ...(description ? { description } : {}),
    alternates: { canonical: url },
    // A site-wide noindex covers every detail page too.
    robots: robotsFor(site?.seo),
    openGraph: {
      type: "article",
      siteName: tenant.name,
      title: post.title,
      url,
      ...(description ? { description } : {}),
      ...(post.published_at ? { publishedTime: post.published_at } : {}),
      modifiedTime: post.updated_at,
      ...(post.cover_image_url ? { images: [{ url: post.cover_image_url }] } : {}),
    },
  };
}

/** A published news post (website-builder.md §4: `NewsArticle` structured data). */
export default async function NewsPostPage({ params }: RouteParams) {
  const { slug } = await params;
  const resolution = await resolveTenant();
  if (resolution.status === "unknown") notFound();
  if (resolution.status === "unavailable") return <UnavailableNotice />;

  const { tenant, host } = resolution;
  const [post, site] = await Promise.all([
    getNewsPost(tenant.id, host, slug),
    getSite(tenant.id, host),
  ]);
  if (!post) notFound();

  const origin = canonicalOrigin(tenant, host);
  const url = `${origin}/news/${post.slug}`;
  const organization = { "@type": "Organization", name: tenant.name, url: origin };

  return (
    <SiteChrome tenant={tenant} site={site}>
      <article className="mx-auto max-w-3xl space-y-6 px-6 py-16">
        <header className="space-y-2">
          <h1 className="font-heading text-3xl font-semibold text-foreground">{post.title}</h1>
          {post.published_at ? (
            <time dateTime={post.published_at} className="block text-sm text-foreground/60">
              {schoolDateFormatter(tenant.locale).format(new Date(post.published_at))}
            </time>
          ) : null}
        </header>
        {post.cover_image_url ? (
          <Image
            src={post.cover_image_url}
            alt=""
            width={1200}
            height={675}
            sizes="(min-width: 768px) 768px, 100vw"
            className="aspect-video h-auto w-full rounded-[var(--sh-radius)] object-cover"
            preload
          />
        ) : null}
        <RichTextBlocks document={post.body} />
      </article>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "NewsArticle",
          headline: post.title,
          description: post.excerpt || undefined,
          image: post.cover_image_url ? [post.cover_image_url] : undefined,
          datePublished: post.published_at ?? undefined,
          dateModified: post.updated_at,
          mainEntityOfPage: url,
          author: organization,
          publisher: organization,
        }}
      />
    </SiteChrome>
  );
}
