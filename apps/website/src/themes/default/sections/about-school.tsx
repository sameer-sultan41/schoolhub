import Image from "next/image";
import { z } from "zod";
import type { SectionProps } from "@/themes/types";

const schema = z.object({
  heading: z.string().default("About our school"),
  body: z.string().min(1),
  image_url: z.url().optional(),
  image_alt: z.string().optional(),
});

export function AboutSchool({ section }: SectionProps) {
  const parsed = schema.safeParse(section.props);
  if (!parsed.success) return null;
  const { heading, body, image_url, image_alt } = parsed.data;

  return (
    <section className="mx-auto grid max-w-5xl gap-10 px-6 py-16 md:grid-cols-2 md:items-center">
      <div className="space-y-4">
        <h2 className="font-heading text-2xl font-semibold text-foreground">{heading}</h2>
        {body.split("\n\n").map((paragraph, index) => (
          <p key={index} className="text-pretty text-foreground/80">
            {paragraph}
          </p>
        ))}
      </div>
      {image_url ? (
        <Image
          src={image_url}
          alt={image_alt ?? ""}
          width={640}
          height={480}
          className="h-auto w-full rounded-[var(--sh-radius)] object-cover"
        />
      ) : null}
    </section>
  );
}
