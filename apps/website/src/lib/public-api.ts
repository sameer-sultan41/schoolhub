import { publicEnv } from "./env.client";

/**
 * Browser-side calls to the public API — the one write path the renderer has.
 *
 * Deliberately separate from `./api.ts`, which is server-only and read-only by design (it
 * carries the renderer's machine token and must never gain a POST). Public forms post **from
 * the browser** straight to the public endpoints, so the machine token is never involved
 * (website-builder.md §6); the API re-validates the tenant, rate-limits and de-duplicates.
 */
export const PUBLIC_ENDPOINTS = {
  contact: "/api/v1/public/contact-messages",
  admission_enquiry: "/api/v1/public/admission-enquiries",
} as const;

export type PublicFormKind = keyof typeof PUBLIC_ENDPOINTS;

/** Posts a public form. Resolves to whether the API accepted it; rejects on network failure. */
export async function submitPublicForm(
  kind: PublicFormKind,
  tenantSlug: string,
  fields: Record<string, FormDataEntryValue>,
): Promise<boolean> {
  const response = await fetch(`${publicEnv.NEXT_PUBLIC_API_ORIGIN}${PUBLIC_ENDPOINTS[kind]}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Re-validated server-side against the request's host; never trusted as-is.
      "X-Tenant-Slug": tenantSlug,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(fields),
  });
  return response.ok;
}
