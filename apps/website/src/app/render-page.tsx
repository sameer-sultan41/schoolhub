import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPage, getSiteSettings, toPageSlug } from "@/lib/content";
import { canonicalOrigin, getRequestHost, resolveTenant } from "@/lib/tenant";
import { getTheme, resolveSection } from "@/themes";

/**
 * Shared page renderer used by both `/` and `/[...slug]`.
 *
 * Flow (website-builder.md §7): host → tenant → published page + sections → theme
 * components → HTML, cached by ISR under (tenant, path) and invalidated by the publish
 * webhook through the per-tenant cache tags set in `lib/content.ts`.
 */

export async function renderPageMetadata(segments: string[] | undefined): Promise<Metadata> {
  const resolution = await resolveTenant();
  if (resolution.status !== "active") {
    // Unknown or suspended sites must never be indexed.
    return { title: "Not available", robots: { index: false, follow: false } };
  }

  const tenant = resolution.tenant;
  const slug = toPageSlug(segments);
  const page = await getPage(tenant.id, slug);
  if (!page) return { title: tenant.name, robots: { index: false, follow: false } };

  const host = (await getRequestHost()) ?? `${tenant.slug}.schoolhub`;
  const origin = canonicalOrigin(tenant, host);
  const path = slug ? `/${slug}` : "/";
  const title = page.seo.title ?? page.title;
  const description = page.seo.description ?? undefined;
  const images = page.seo.og_image_url ? [{ url: page.seo.og_image_url }] : undefined;

  return {
    title,
    ...(description ? { description } : {}),
    alternates: { canonical: page.seo.canonical_url ?? `${origin}${path}` },
    robots: page.seo.noindex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      type: "website",
      siteName: tenant.name,
      title,
      ...(description ? { description } : {}),
      url: `${origin}${path}`,
      ...(images ? { images } : {}),
    },
  };
}

export async function RenderPage({ segments }: { segments: string[] | undefined }) {
  const resolution = await resolveTenant();

  // Unknown host → 404. A suspended tenant gets a neutral notice, never another
  // tenant's content (multi-tenancy.md §7).
  if (resolution.status === "unknown") notFound();
  if (resolution.status === "suspended") {
    return (
      <main className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="font-heading text-2xl font-semibold">This website is unavailable</h1>
        <p className="mt-3 text-foreground/75">
          The site is temporarily offline. Please contact the school directly.
        </p>
      </main>
    );
  }

  const tenant = resolution.tenant;
  const slug = toPageSlug(segments);
  const [page, settings] = await Promise.all([
    getPage(tenant.id, slug),
    getSiteSettings(tenant.id),
  ]);

  if (!page || !page.is_published) notFound();

  // v1 ships one theme; the tenant's theme-selection setting is read here once it exists
  // (website-builder.md §5) — the registry lookup already supports it.
  const theme = getTheme(null);
  const { Navigation, Footer } = theme;
  const sections = [...page.sections].sort((a, b) => a.position - b.position);

  return (
    <>
      <Navigation tenant={tenant} settings={settings} />
      <main>
        {sections.map((section) => {
          const Section = resolveSection(theme, section);
          // Unknown section types render nothing — forward compatibility as themes evolve.
          if (!Section) return null;
          return <Section key={section.id} section={section} tenant={tenant} />;
        })}
      </main>
      <Footer tenant={tenant} settings={settings} />
    </>
  );
}
