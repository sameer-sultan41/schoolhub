import type { ApiSchemas } from "@schoolhub/api-client";
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
import { getEvent, getSite } from "@/lib/content";
import { schoolDateFormatter } from "@/lib/dates";
import { canonicalOrigin, resolveTenant } from "@/lib/tenant";
import { COPY } from "@/themes/default/copy";
import { RichTextBlocks } from "@/themes/default/rich-text-blocks";

interface RouteParams {
  params: Promise<{ slug: string }>;
}

type SchoolEvent = ApiSchemas["PublicSchoolEventDetail"];

/** ISR per (tenant, slug); a publish fires the revalidation webhook (website-builder.md §3). */
export const revalidate = 300;
export const dynamicParams = true;

/** "12 Apr 2027" for an all-day event, else with times; a range when it has an end. */
function formatWhen(event: SchoolEvent, locale: ApiSchemas["PublicTenantLocale"]): string {
  const formatter = schoolDateFormatter(locale, { withTime: !event.is_all_day });
  const start = new Date(event.starts_at);
  return event.ends_at
    ? formatter.formatRange(start, new Date(event.ends_at))
    : formatter.format(start);
}

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { slug } = await params;
  const resolution = await resolveTenant();
  if (resolution.status !== "active") return UNAVAILABLE_METADATA;

  const { tenant, host } = resolution;
  const [event, site] = await Promise.all([
    getEvent(tenant.id, host, slug),
    getSite(tenant.id, host),
  ]);
  if (!event) return missingContentMetadata(tenant);

  const url = `${canonicalOrigin(tenant, host)}/events/${event.slug}`;
  return {
    title: event.title,
    alternates: { canonical: url },
    // A site-wide noindex covers every detail page too.
    robots: robotsFor(site?.seo),
    openGraph: {
      type: "website",
      siteName: tenant.name,
      title: event.title,
      url,
      ...(event.cover_image_url ? { images: [{ url: event.cover_image_url }] } : {}),
    },
  };
}

/** A published school event (website-builder.md §4: `Event` structured data). */
export default async function EventPage({ params }: RouteParams) {
  const { slug } = await params;
  const resolution = await resolveTenant();
  if (resolution.status === "unknown") notFound();
  if (resolution.status === "unavailable") return <UnavailableNotice />;

  const { tenant, host } = resolution;
  const [event, site] = await Promise.all([
    getEvent(tenant.id, host, slug),
    getSite(tenant.id, host),
  ]);
  if (!event) notFound();

  const origin = canonicalOrigin(tenant, host);

  return (
    <SiteChrome tenant={tenant} site={site}>
      <article className="mx-auto max-w-3xl space-y-6 px-6 py-16">
        <header className="space-y-2">
          <h1 className="font-heading text-3xl font-semibold text-foreground">{event.title}</h1>
          <p className="text-sm text-foreground/70">
            <time dateTime={event.starts_at}>{formatWhen(event, tenant.locale)}</time>
            {event.is_all_day ? ` · ${COPY.events.allDay}` : null}
          </p>
          {event.location ? <p className="text-sm text-foreground/70">{event.location}</p> : null}
        </header>
        {event.cover_image_url ? (
          <Image
            src={event.cover_image_url}
            alt=""
            width={1200}
            height={675}
            sizes="(min-width: 768px) 768px, 100vw"
            className="aspect-video h-auto w-full rounded-[var(--sh-radius)] object-cover"
            preload
          />
        ) : null}
        <RichTextBlocks document={event.description} />
      </article>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Event",
          name: event.title,
          startDate: event.starts_at,
          endDate: event.ends_at ?? undefined,
          eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
          location: event.location ? { "@type": "Place", name: event.location } : undefined,
          image: event.cover_image_url ? [event.cover_image_url] : undefined,
          url: `${origin}/events/${event.slug}`,
          organizer: { "@type": "Organization", name: tenant.name, url: origin },
        }}
      />
    </SiteChrome>
  );
}
