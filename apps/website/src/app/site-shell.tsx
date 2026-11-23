import type { ApiSchemas } from "@schoolhub/api-client";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { type PublicSite, type PublicTenant, getTheme } from "@/themes";
import { COPY } from "@/themes/default/copy";

/**
 * What every rendered route shares (website-builder.md §7): the neutral notice for a site that
 * is not available, and the theme's chrome around the content.
 */

/** Unknown, suspended, unpublished or maintenance sites are never indexed. */
export const UNAVAILABLE_METADATA: Metadata = {
  title: COPY.unavailable.metadataTitle,
  robots: { index: false, follow: false },
};

type PublicSeo = ApiSchemas["PublicSeo"];

function allows(seo: PublicSeo): { index: boolean; follow: boolean } {
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

/**
 * `noindex` plus the free-text `robots` directives (`noindex`, `nofollow`, `none`; others are
 * ignored), across every SEO source given (the site's and the page's). Any source can only narrow
 * indexing, never widen it; a missing source (no site row) allows.
 */
export function robotsFor(...sources: (PublicSeo | null | undefined)[]): {
  index: boolean;
  follow: boolean;
} {
  return sources.reduce<{ index: boolean; follow: boolean }>(
    (robots, seo) => {
      if (!seo) return robots;
      const own = allows(seo);
      return { index: robots.index && own.index, follow: robots.follow && own.follow };
    },
    { index: true, follow: true },
  );
}

/** A route whose content the API does not answer: titled for the school, never indexed. */
export function missingContentMetadata(tenant: PublicTenant): Metadata {
  return { title: tenant.name, robots: { index: false, follow: false } };
}

/** A suspended school, or a site in maintenance or not yet published: never another tenant's content. */
export function UnavailableNotice() {
  return (
    <main className="mx-auto max-w-xl px-6 py-24 text-center">
      <h1 className="font-heading text-2xl font-semibold">{COPY.unavailable.title}</h1>
      <p className="mt-3 text-foreground/75">{COPY.unavailable.body}</p>
    </main>
  );
}

/** The site's theme chrome (navigation, footer) around a route's content. */
export function SiteChrome({
  tenant,
  site,
  children,
}: {
  tenant: PublicTenant;
  site: PublicSite | null;
  children: ReactNode;
}) {
  const { Navigation, Footer } = getTheme(site?.theme.code);
  return (
    <>
      <Navigation tenant={tenant} site={site} />
      <main>{children}</main>
      <Footer tenant={tenant} site={site} />
    </>
  );
}
