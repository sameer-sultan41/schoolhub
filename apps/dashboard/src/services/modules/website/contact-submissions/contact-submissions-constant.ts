import { FILTER_ALL } from "@/lib/constants";
import { isIsoDate } from "@/lib/helpers";

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

const STATUS_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...CONTACT_SUBMISSION_STATUSES];

/** The inbox's URL filters (ADR-0024): one status or all, and an inclusive received-date range. */
export const CONTACT_URL_FILTERS = {
  status: { default: FILTER_ALL, isValid: (value: string) => STATUS_FILTER_VALUES.includes(value) },
  from: { default: "", isValid: (value: string) => value === "" || isIsoDate(value) },
  to: { default: "", isValid: (value: string) => value === "" || isIsoDate(value) },
};

/** Sortable column id -> the view's `ordering_fields`. No sort means newest first (the server's). */
export const CONTACT_SORT_FIELD: Readonly<Record<string, string>> = {
  created_at: "created_at",
  name: "name",
  status: "status",
};
