import Link from "next/link";
import { z } from "zod";
import type { SectionProps } from "@/themes/types";

const schema = z.object({
  heading: z.string().default("Admissions are open"),
  body: z.string().optional(),
  cta_label: z.string().default("Apply now"),
  cta_href: z.string().default("/admissions"),
});

export function AdmissionsCta({ section }: SectionProps) {
  const parsed = schema.safeParse(section.props);
  if (!parsed.success) return null;
  const { heading, body, cta_label, cta_href } = parsed.data;

  return (
    <section className="bg-primary text-primary-foreground">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-6 py-14 text-center">
        <h2 className="font-heading text-2xl font-semibold">{heading}</h2>
        {body ? <p className="max-w-2xl text-pretty opacity-90">{body}</p> : null}
        <Link
          href={cta_href}
          className="inline-flex h-11 items-center rounded-[var(--sh-radius)] bg-background px-6 text-sm font-medium text-foreground"
        >
          {cta_label}
        </Link>
      </div>
    </section>
  );
}
