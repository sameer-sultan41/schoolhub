import { z } from "zod";
import { getNotices } from "@/lib/content";
import type { SectionProps } from "@/themes/types";

const schema = z.object({
  heading: z.string().default("Notice board"),
  limit: z.number().int().min(1).max(30).default(8),
});

export async function NoticeBoard({ section, tenant }: SectionProps) {
  const parsed = schema.safeParse(section.props);
  if (!parsed.success) return null;

  const notices = await getNotices(tenant.id, parsed.data.limit);
  if (notices.length === 0) return null;

  const formatter = new Intl.DateTimeFormat(tenant.locale.default_locale, {
    dateStyle: "medium",
    timeZone: tenant.locale.timezone,
  });

  return (
    <section className="bg-secondary/60">
      <div className="mx-auto max-w-4xl px-6 py-16">
        <h2 className="font-heading text-2xl font-semibold text-foreground">
          {parsed.data.heading}
        </h2>
        <ul className="mt-6 divide-y divide-black/10">
          {notices.map((notice) => (
            <li key={notice.id} className="py-4">
              <time dateTime={notice.published_at} className="text-xs text-foreground/60">
                {formatter.format(new Date(notice.published_at))}
              </time>
              <h3 className="font-medium text-foreground">{notice.title}</h3>
              {notice.body ? (
                <p className="mt-1 text-sm text-foreground/75">{notice.body}</p>
              ) : null}
              {notice.attachment_url ? (
                <a
                  href={notice.attachment_url}
                  className="mt-1 inline-block text-sm text-primary underline underline-offset-4"
                >
                  Download attachment
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
