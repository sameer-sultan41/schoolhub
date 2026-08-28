import { z } from "zod";
import { getClasses } from "@/lib/content";
import type { SectionProps } from "@/themes/types";

const schema = z.object({
  heading: z.string().default("Classes we offer"),
});

export async function ClassesList({ section, tenant }: SectionProps) {
  const parsed = schema.safeParse(section.props);
  if (!parsed.success) return null;

  const classes = await getClasses(tenant.id);
  if (classes.length === 0) return null;

  return (
    <section className="mx-auto max-w-4xl px-6 py-16">
      <h2 className="font-heading text-2xl font-semibold text-foreground">
        {parsed.data.heading}
      </h2>
      <dl className="mt-6 divide-y divide-black/10 border-y border-black/10">
        {classes.map((schoolClass) => (
          <div key={schoolClass.id} className="flex flex-wrap gap-x-6 gap-y-1 py-4">
            <dt className="w-40 font-medium text-foreground">{schoolClass.name}</dt>
            <dd className="flex-1 text-sm text-foreground/75">
              {schoolClass.description ?? schoolClass.level ?? ""}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
