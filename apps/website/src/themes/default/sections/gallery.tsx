import Image from "next/image";
import { z } from "zod";
import { getGallery } from "@/lib/content";
import type { SectionProps } from "@/themes/types";

const schema = z.object({
  heading: z.string().default("Gallery"),
  limit: z.number().int().min(1).max(60).default(24),
});

export async function Gallery({ section, tenant }: SectionProps) {
  const parsed = schema.safeParse(section.props);
  if (!parsed.success) return null;

  const images = await getGallery(tenant.id, parsed.data.limit);
  if (images.length === 0) return null;

  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <h2 className="font-heading text-2xl font-semibold text-foreground">
        {parsed.data.heading}
      </h2>
      <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {images.map((image) => (
          <li key={image.id}>
            <figure>
              <Image
                src={image.url}
                alt={image.alt}
                width={image.width ?? 400}
                height={image.height ?? 300}
                className="aspect-square w-full rounded-[var(--sh-radius)] object-cover"
              />
              {image.caption ? (
                <figcaption className="mt-1 text-xs text-foreground/70">
                  {image.caption}
                </figcaption>
              ) : null}
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}
