import Image from "next/image";
import { z } from "zod";
import { getTeachers } from "@/lib/content";
import type { SectionProps } from "@/themes/types";

const schema = z.object({
  heading: z.string().default("Our teachers"),
  limit: z.number().int().min(1).max(60).default(12),
});

/**
 * Staff appear here **only** when the tenant has opted the profile in
 * (`show_on_website`) — the API filters; the renderer never asks for private profiles.
 * No contact details, no personal identifiers beyond what the school published.
 */
export async function TeachersGrid({ section, tenant }: SectionProps) {
  const parsed = schema.safeParse(section.props);
  if (!parsed.success) return null;

  const teachers = await getTeachers(tenant.id, parsed.data.limit);
  if (teachers.length === 0) return null;

  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <h2 className="font-heading text-2xl font-semibold text-foreground">{parsed.data.heading}</h2>
      <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {teachers.map((teacher) => (
          <li key={teacher.id} className="text-center">
            {teacher.photo_url ? (
              <Image
                src={teacher.photo_url}
                alt=""
                width={160}
                height={160}
                className="mx-auto size-32 rounded-full object-cover"
              />
            ) : (
              <div className="mx-auto size-32 rounded-full bg-secondary" aria-hidden="true" />
            )}
            <p className="mt-3 font-medium text-foreground">{teacher.full_name}</p>
            {teacher.designation ? (
              <p className="text-sm text-foreground/70">{teacher.designation}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
