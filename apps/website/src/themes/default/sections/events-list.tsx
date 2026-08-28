import { z } from "zod";
import { getEvents } from "@/lib/content";
import type { SectionProps } from "@/themes/types";

const schema = z.object({
  heading: z.string().default("Upcoming events"),
  limit: z.number().int().min(1).max(24).default(6),
});

/** Public-flagged items from the Communication module. */
export async function EventsList({ section, tenant }: SectionProps) {
  const parsed = schema.safeParse(section.props);
  if (!parsed.success) return null;

  const events = await getEvents(tenant.id, parsed.data.limit);
  if (events.length === 0) return null;

  const formatter = new Intl.DateTimeFormat(tenant.locale.default_locale, {
    dateStyle: "medium",
    timeZone: tenant.locale.timezone,
  });

  return (
    <section className="mx-auto max-w-4xl px-6 py-16">
      <h2 className="font-heading text-2xl font-semibold text-foreground">
        {parsed.data.heading}
      </h2>
      <ul className="mt-6 space-y-4">
        {events.map((event) => (
          <li
            key={event.id}
            className="rounded-[var(--sh-radius)] border border-black/10 px-5 py-4"
          >
            <time dateTime={event.starts_at} className="text-sm text-foreground/70">
              {formatter.format(new Date(event.starts_at))}
            </time>
            <h3 className="font-heading text-base font-semibold text-foreground">
              {event.title}
            </h3>
            {event.location ? (
              <p className="text-sm text-foreground/70">{event.location}</p>
            ) : null}
            {event.summary ? (
              <p className="mt-1 text-sm text-foreground/80">{event.summary}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
