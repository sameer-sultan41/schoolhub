import type { ApiSchemas } from "@schoolhub/api-client";

/**
 * Browser-side calls to the public API — the one write path the renderer has.
 *
 * Deliberately separate from `./api.ts`, which is server-only and read-only by design (it
 * carries the renderer's machine token and must never gain a POST). Public forms post **from
 * the browser** straight to the public endpoint, so the machine token is never involved
 * (website-builder.md §6); the API re-validates the tenant, rate-limits and de-duplicates.
 */
export const CONTACT_SUBMISSIONS_PATH = "/api/v1/public/contact-submissions";

/** The honeypot field: a bot fills it, the API then answers 201 and stores nothing. */
export const HONEYPOT_FIELD = "company_website";

/**
 * The admissions-enquiry form posts as a contact submission with this subject until the
 * admission-form endpoint ships with the admissions module (website-cms §16, deferred).
 */
export const ADMISSION_ENQUIRY_SUBJECT = "Admission enquiry";

export type PublicFormKind = "contact" | "admission_enquiry";

export type PublicContactSubmission = ApiSchemas["PublicContactSubmission"];

/**
 * Posts a public form. Resolves to whether the API accepted it; rejects on network failure.
 *
 * `apiOrigin` is the server's runtime `API_PUBLIC_ORIGIN`, handed down as a prop: empty means
 * same-origin. Never a `NEXT_PUBLIC` value, which would be fixed when the image is built.
 *
 * `idempotencyKey` is random and belongs to one fill of the form, so a retry after a lost
 * response replays the first answer instead of storing the message twice. A guessable key would
 * let a later visitor replay another's reply.
 */
export async function submitPublicForm(
  apiOrigin: string,
  kind: PublicFormKind,
  tenantSlug: string,
  submission: PublicContactSubmission,
  idempotencyKey: string,
): Promise<boolean> {
  const body: PublicContactSubmission =
    kind === "admission_enquiry"
      ? { ...submission, subject: ADMISSION_ENQUIRY_SUBJECT }
      : submission;

  const response = await fetch(`${apiOrigin}${CONTACT_SUBMISSIONS_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Re-validated server-side against the request's Origin; never trusted as-is.
      "X-Tenant-Slug": tenantSlug,
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  return response.ok;
}
