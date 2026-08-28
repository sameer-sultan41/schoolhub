import Image from "next/image";
import { z } from "zod";
import type { SectionProps } from "@/themes/types";

const schema = z.object({
  heading: z.string().default("Message from the Principal"),
  message: z.string().min(1),
  principal_name: z.string().optional(),
  principal_title: z.string().optional(),
  photo_url: z.url().optional(),
});

export function PrincipalMessage({ section }: SectionProps) {
  const parsed = schema.safeParse(section.props);
  if (!parsed.success) return null;
  const { heading, message, principal_name, principal_title, photo_url } = parsed.data;

  return (
    <section className="bg-secondary/60">
      <div className="mx-auto max-w-4xl px-6 py-16">
        <h2 className="font-heading text-2xl font-semibold text-foreground">{heading}</h2>
        <figure className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-start">
          {photo_url ? (
            <Image
              src={photo_url}
              alt={principal_name ?? ""}
              width={128}
              height={128}
              className="size-32 shrink-0 rounded-full object-cover"
            />
          ) : null}
          <div className="space-y-4">
            <blockquote className="text-pretty text-foreground/85">{message}</blockquote>
            {principal_name ? (
              <figcaption className="text-sm text-foreground/70">
                <span className="font-medium text-foreground">{principal_name}</span>
                {principal_title ? ` · ${principal_title}` : null}
              </figcaption>
            ) : null}
          </div>
        </figure>
      </div>
    </section>
  );
}
