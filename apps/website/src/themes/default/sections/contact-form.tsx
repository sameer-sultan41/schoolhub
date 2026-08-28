import { z } from "zod";
import { PublicEnquiryForm } from "@/components/public-enquiry-form";
import type { SectionProps } from "@/themes/types";

const schema = z.object({
  heading: z.string().default("Contact us"),
  intro: z.string().optional(),
  /** Which public endpoint the browser posts to. */
  form: z.enum(["contact", "admission_enquiry"]).default("contact"),
});

/**
 * The form POSTs from the **browser** directly to the rate-limited public API endpoint —
 * never through the renderer's machine token (website-builder.md §6). This server component
 * only renders the shell and the tenant's contact details.
 */
export function ContactForm({ section, tenant }: SectionProps) {
  const parsed = schema.safeParse(section.props);
  if (!parsed.success) return null;
  const { heading, intro, form } = parsed.data;

  return (
    <section className="mx-auto grid max-w-5xl gap-10 px-6 py-16 md:grid-cols-2">
      <div className="space-y-3">
        <h2 className="font-heading text-2xl font-semibold text-foreground">{heading}</h2>
        {intro ? <p className="text-foreground/75">{intro}</p> : null}
        <address className="space-y-1 text-sm text-foreground/80 not-italic">
          {tenant.contact?.address ? <p>{tenant.contact.address}</p> : null}
          {tenant.contact?.phone ? (
            <p>
              <a href={`tel:${tenant.contact.phone}`} className="hover:underline">
                {tenant.contact.phone}
              </a>
            </p>
          ) : null}
          {tenant.contact?.email ? (
            <p>
              <a href={`mailto:${tenant.contact.email}`} className="hover:underline">
                {tenant.contact.email}
              </a>
            </p>
          ) : null}
        </address>
      </div>

      <PublicEnquiryForm kind={form} tenantSlug={tenant.slug} />
    </section>
  );
}
