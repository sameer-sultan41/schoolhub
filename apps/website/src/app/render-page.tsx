import type { ApiSchemas } from "@schoolhub/api-client";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPage, getSite, toPageSlug } from "@/lib/content";
import { canonicalOrigin, resolveTenant } from "@/lib/tenant";
import { getTheme, resolveSection } from "@/themes";

/**
 * Shared page renderer used by both `/` and `/[...slug]`.
 *
 * Flow (website-builder.md §7): host → tenant → published page + sections → theme
 * components → HTML, cached by ISR under (tenant, path) and invalidated by the publish
 * webhook through the per-tenant cache tags set in `lib/content.ts`.
 */

const UNAVAILABLE_METADATA: Metadata = {
  title: "Not available",
  robots: { index: false, follow: false },
};

/**
 * `noindex` plus the free-text `robots` directives (`noindex`, `nofollow`, `none`; others are
 * ignored). Either source can only narrow indexing, never widen it.
 */
export function robotsFor(seo: ApiSchemas["PublicSeo"]): { index: boolean; follow: boolean } {
  const directives = new Set(
    (seo.robots ?? "")
      .toLowerCase()
      .split(",")
      .map((directive) => directive.trim()),
  );
  const none = directives.has("none");
  return {
    index: !seo.noindex && !none && !directives.has("noindex"),
    follow: !seo.noindex && !none && !directives.has("nofollow"),
  };
}

/** A `/`-relative canonical (the API's safe-url allows one) is made absolute on the school's origin. */
function canonicalUrl(seo: ApiSchemas["PublicSeo"], origin: string, path: string): string {
  const canonical = seo.canonical_url;
  if (!canonical) return `${origin}${path}`;
  return canonical.startsWith("/") ? `${origin}${canonical}` : canonical;
}

export async function renderPageMetadata(segments: string[] | undefined): Promise<Metadata> {
  const resolution = await resolveTenant();
  // Unknown, suspended, unpublished or maintenance sites must never be indexed.
  if (resolution.status !== "active") return UNAVAILABLE_METADATA;

  const { tenant, host } = resolution;
  const slug = toPageSlug(segments);
  const page = await getPage(tenant.id, host, slug);
  if (!page) return { title: tenant.name, robots: { index: false, follow: false } };

  const origin = canonicalOrigin(tenant, host);
  const title = page.seo.title ?? page.title;
  const description = page.seo.description ?? undefined;
  const images = page.seo.og_image_url ? [{ url: page.seo.og_image_url }] : undefined;

  return {
    title,
    ...(description ? { description } : {}),
    alternates: { canonical: canonicalUrl(page.seo, origin, page.path) },
    robots: robotsFor(page.seo),
    openGraph: {
      type: "website",
      siteName: tenant.name,
      title,
      ...(description ? { description } : {}),
      url: `${origin}${page.path}`,
      ...(images ? { images } : {}),
    },
  };
}

export async function RenderPage({ segments }: { segments: string[] | undefined }) {
  const resolution = await resolveTenant();

  // Unknown host → 404. A suspended school, or a site in maintenance or not yet published,
  // gets a neutral notice, never another tenant's content (multi-tenancy.md §7).
  if (resolution.status === "unknown") notFound();
  if (resolution.status === "unavailable") {
    return (
      <main className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="font-heading text-2xl font-semibold">This website is unavailable</h1>
        <p className="mt-3 text-foreground/75">
          The site is temporarily offline. Please contact the school directly.
        </p>
      </main>
    );
  }

  const { tenant, host } = resolution;
  const slug = toPageSlug(segments);
  const [page, site] = await Promise.all([
    getPage(tenant.id, host, slug),
    getSite(tenant.id, host),
  ]);

  // The API answers only a published page (or the preview token's page); anything else is 404.
  if (!page) notFound();

  const theme = getTheme(site?.theme.code);
  const { Navigation, Footer } = theme;
  const sections = [...page.sections].sort((a, b) => a.position - b.position);

  return (
    <>
      <Navigation tenant={tenant} site={site} />
      <main>
        {sections.map((section) => {
          const Section = resolveSection(theme, section);
          // Unknown section types render nothing — forward compatibility as themes evolve.
          if (!Section) return null;
          return (
            <Section
              key={section.id}
              section={section}
              tenant={tenant}
              host={host}
              pageId={page.id}
            />
          );
        })}
      </main>
      <Footer tenant={tenant} site={site} />
    </>
  );
}
