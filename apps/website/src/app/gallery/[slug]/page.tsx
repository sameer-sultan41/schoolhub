import type { ApiSchemas } from "@schoolhub/api-client";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import {
  SiteChrome,
  UNAVAILABLE_METADATA,
  UnavailableNotice,
  missingContentMetadata,
} from "@/app/site-shell";
import { getAlbum, getSite } from "@/lib/content";
import { canonicalOrigin, resolveTenant } from "@/lib/tenant";
import { COPY } from "@/themes/default/copy";

interface RouteParams {
  params: Promise<{ slug: string }>;
}

type GalleryItem = ApiSchemas["PublicGalleryItem"];

/** ISR per (tenant, slug); a publish fires the revalidation webhook (website-builder.md §3). */
export const revalidate = 300;
export const dynamicParams = true;

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { slug } = await params;
  const resolution = await resolveTenant();
  if (resolution.status !== "active") return UNAVAILABLE_METADATA;

  const { tenant, host } = resolution;
  const album = await getAlbum(tenant.id, host, slug);
  if (!album) return missingContentMetadata(tenant);

  const url = `${canonicalOrigin(tenant, host)}/gallery/${album.slug}`;
  const description = album.description || undefined;
  return {
    title: album.title,
    ...(description ? { description } : {}),
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: tenant.name,
      title: album.title,
      url,
      ...(description ? { description } : {}),
      ...(album.cover_image_url ? { images: [{ url: album.cover_image_url }] } : {}),
    },
  };
}

function AlbumItem({ item }: { item: GalleryItem }) {
  if (item.image_url) {
    return (
      <figure>
        <Image
          src={item.image_url}
          alt={item.alt_text || item.caption}
          width={400}
          height={400}
          className="aspect-square w-full rounded-[var(--sh-radius)] object-cover"
        />
        {item.caption ? (
          <figcaption className="mt-1 text-xs text-foreground/70">{item.caption}</figcaption>
        ) : null}
      </figure>
    );
  }
  // A video stays on its host (the API admits only YouTube and Vimeo https URLs): a link, no embed.
  if (item.embed_url?.startsWith("https://")) {
    return (
      <a
        href={item.embed_url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex aspect-square w-full items-center justify-center rounded-[var(--sh-radius)] bg-secondary p-4 text-center text-sm font-medium text-foreground hover:underline"
      >
        {item.caption || COPY.gallery.watchVideo}
      </a>
    );
  }
  return null;
}

/** A published album: its items in order, capped by the API (`item_count` is the full total). */
export default async function AlbumPage({ params }: RouteParams) {
  const { slug } = await params;
  const resolution = await resolveTenant();
  if (resolution.status === "unknown") notFound();
  if (resolution.status === "unavailable") return <UnavailableNotice />;

  const { tenant, host } = resolution;
  const [album, site] = await Promise.all([
    getAlbum(tenant.id, host, slug),
    getSite(tenant.id, host),
  ]);
  if (!album) notFound();

  const items = [...album.items].sort((a, b) => a.position - b.position);

  return (
    <SiteChrome tenant={tenant} site={site}>
      <section className="mx-auto max-w-5xl space-y-6 px-6 py-16">
        <header className="space-y-2">
          <h1 className="font-heading text-3xl font-semibold text-foreground">{album.title}</h1>
          {album.description ? (
            <p className="whitespace-pre-line text-foreground/75">{album.description}</p>
          ) : null}
        </header>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <li key={item.id}>
              <AlbumItem item={item} />
            </li>
          ))}
        </ul>
        {album.item_count > items.length ? (
          <p className="text-sm text-foreground/70">
            {COPY.gallery.itemCount(items.length, album.item_count)}
          </p>
        ) : null}
      </section>
    </SiteChrome>
  );
}
