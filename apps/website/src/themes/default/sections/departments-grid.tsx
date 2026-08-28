import { z } from "zod";
import { getDepartments } from "@/lib/content";
import type { SectionProps } from "@/themes/types";

const schema = z.object({
  heading: z.string().default("Departments"),
  intro: z.string().optional(),
});

/** Live data from the Academics module (published entries only), not duplicated into the CMS. */
export async function DepartmentsGrid({ section, tenant }: SectionProps) {
  const parsed = schema.safeParse(section.props);
  if (!parsed.success) return null;

  const departments = await getDepartments(tenant.id);
  if (departments.length === 0) return null;

  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <h2 className="font-heading text-2xl font-semibold text-foreground">
        {parsed.data.heading}
      </h2>
      {parsed.data.intro ? (
        <p className="mt-2 max-w-2xl text-foreground/75">{parsed.data.intro}</p>
      ) : null}

      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {departments.map((department) => (
          <li
            key={department.id}
            className="rounded-[var(--sh-radius)] border border-black/10 p-5"
          >
            <h3 className="font-heading text-base font-semibold text-foreground">
              {department.name}
            </h3>
            {department.description ? (
              <p className="mt-2 text-sm text-foreground/75">{department.description}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
