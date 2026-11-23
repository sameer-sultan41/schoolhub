import { z } from "zod";
import { getClasses } from "@/lib/content";
import type { SectionProps } from "@/themes/types";

const schema = z.object({
  heading: z.string().default("Classes we offer"),
});

export async function ClassesList({ section, tenant, host }: SectionProps) {
  const parsed = schema.safeParse(section.props);
  if (!parsed.success) return null;

  const classes = await getClasses(tenant.id, host);
  if (classes.length === 0) return null;

  return (
    <section className="mx-auto max-w-4xl px-6 py-16">
      <h2 className="font-heading text-2xl font-semibold text-foreground">{parsed.data.heading}</h2>
      {/* `level` only orders the list: the API sends classes in level order already. */}
      <ul className="mt-6 divide-y divide-border border-y border-border">
        {classes.map((schoolClass) => (
          <li key={schoolClass.id} className="py-4 font-medium text-foreground">
            {schoolClass.name}
          </li>
        ))}
      </ul>
    </section>
  );
}
