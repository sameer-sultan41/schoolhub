import { z } from "zod";
import { COPY } from "@/themes/default/copy";
import type { SectionProps } from "@/themes/types";

// Bounds mirror the theme schema (themes/default.json): a payload outside them renders nothing.
const schema = z.object({
  heading: z.string().max(200).default(COPY.faq.heading),
  items: z
    .array(
      z.object({
        question: z.string().min(1).max(300),
        answer: z.string().min(1).max(2000),
      }),
    )
    .min(1),
});

/** Questions and answers as native disclosure widgets: keyboard and screen-reader ready. */
export function Faq({ section }: SectionProps) {
  const parsed = schema.safeParse(section.props);
  if (!parsed.success) return null;

  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      <h2 className="font-heading text-2xl font-semibold text-foreground">{parsed.data.heading}</h2>
      <div className="mt-6 divide-y divide-border border-y border-border">
        {parsed.data.items.map((item, index) => (
          <details key={`${index}-${item.question}`} className="group py-4">
            <summary className="cursor-pointer font-medium text-foreground">
              {item.question}
            </summary>
            <p className="mt-2 whitespace-pre-line text-foreground/75">{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
