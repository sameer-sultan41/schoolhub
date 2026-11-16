import type { ContactSubmissionStatus } from "./contact-submissions-type";

/** The contact inbox's constants. Reads live under `WEBSITE_QUERY_MODULE` (`website-content.ts`). */

export const CONTACT_SUBMISSIONS_RESOURCE = "contact-submissions";

/** Every triage status, keyed so the compiler checks the set against the generated enum. */
const CONTACT_STATUS_SET: Record<ContactSubmissionStatus, true> = {
  new: true,
  read: true,
  responded: true,
  spam: true,
};
export const CONTACT_SUBMISSION_STATUSES = Object.keys(
  CONTACT_STATUS_SET,
) as ContactSubmissionStatus[];
