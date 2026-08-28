import Image from "next/image";
import Link from "next/link";
import { z } from "zod";
import type { SectionProps } from "@/themes/types";

/**
 * Section props are JSONB from the CMS, so every section validates its own shape and
 * degrades to rendering nothing rather than throwing a whole page away.
 */
const schema = z.object({
  heading: z.string().min(1),
  subheading: z.string().optional(),
  image_url: z.url().optional(),
  image_alt: z.string().optional(),
  cta_label: z.string().optional(),
  cta_href: z.string().optional(),
});

export function Hero({ section }: SectionProps) {
  const parsed = schema.safeParse(section.props);
  if (!parsed.success) return null;
  const { heading, subheading, image_url, image_alt, cta_label, cta_href } = parsed.data;

  return (
    <section className="relative isolate overflow-hidden bg-secondary">
      {image_url ? (
        <Image
          src={image_url}
          alt={image_alt ?? ""}
          fill
          priority
          sizes="100vw"
          className="-z-10 object-cover opacity-30"
        />
      ) : null}
      <div className="mx-auto max-w-5xl px-6 py-20 text-center sm:py-28">
        <h1 className="font-heading text-4xl font-semibold text-balance text-foreground sm:text-5xl">
          {heading}
        </h1>
        {subheading ? (
          <p className="mx-auto mt-4 max-w-2xl text-lg text-pretty text-foreground/80">
            {subheading}
          </p>
        ) : null}
        {cta_label && cta_href ? (
          <Link
            href={cta_href}
            className="mt-8 inline-flex h-11 items-center rounded-[var(--sh-radius)] bg-primary px-6 text-sm font-medium text-primary-foreground"
          >
            {cta_label}
          </Link>
        ) : null}
      </div>
    </section>
  );
}
