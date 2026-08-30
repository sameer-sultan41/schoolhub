import Image from "next/image";
import Link from "next/link";
import { z } from "zod";
import { getNews } from "@/lib/content";
import type { SectionProps } from "@/themes/types";

const schema = z.object({
  heading: z.string().default("Latest news"),
  limit: z.number().int().min(1).max(24).default(6),
});

export async function NewsList({ section, tenant }: SectionProps) {
  const parsed = schema.safeParse(section.props);
  if (!parsed.success) return null;

  const posts = await getNews(tenant.id, parsed.data.limit);
  if (posts.length === 0) return null;

  const formatter = new Intl.DateTimeFormat(tenant.locale.default_locale, {
    dateStyle: "medium",
    timeZone: tenant.locale.timezone,
  });

  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <h2 className="font-heading text-2xl font-semibold text-foreground">{parsed.data.heading}</h2>
      <ul className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => (
          <li key={post.id} className="space-y-3">
            {post.cover_image_url ? (
              <Image
                src={post.cover_image_url}
                alt=""
                width={480}
                height={270}
                className="aspect-video w-full rounded-[var(--sh-radius)] object-cover"
              />
            ) : null}
            <time dateTime={post.published_at} className="block text-xs text-foreground/60">
              {formatter.format(new Date(post.published_at))}
            </time>
            <h3 className="font-heading text-base font-semibold">
              <Link href={`/news/${post.slug}`} className="text-foreground hover:underline">
                {post.title}
              </Link>
            </h3>
            {post.excerpt ? (
              <p className="text-sm text-pretty text-foreground/75">{post.excerpt}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
