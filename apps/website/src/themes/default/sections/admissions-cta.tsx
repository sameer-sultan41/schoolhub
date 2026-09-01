import { Button } from "@schoolhub/ui";
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
        {/*
          No Button variant is "inverted" (light fill on a coloured section) — this is
          the one genuine one-off, not a case for a new permanent variant over a single
          use site. bg-background and text-foreground override the primary variant's own
          bg-primary/text-primary-foreground classes; both sides share the same
          background-color/text-color class groups tailwind-merge dedupes on, so the
          override reliably wins. hover:opacity-100 is load-bearing, not decorative: the
          primary variant's own hover is hover:opacity-90 (a different tailwind-merge
          group than hover:bg-background/90, so it survives untouched) — without this,
          hovering would fade the whole button, text included, to 90% opacity on top of
          the background-colour change below.
        */}
        <Button
          asChild
          size="lg"
          className="bg-background text-foreground hover:bg-background/90 hover:opacity-100"
        >
          <Link href={cta_href}>{cta_label}</Link>
        </Button>
      </div>
    </section>
  );
}
