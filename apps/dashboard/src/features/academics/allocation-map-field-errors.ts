import type { AllocationFormValues } from "@/features/academics/allocation-schema";

/** Whitelist of server field names the allocation form actually has an input for.
 * `services.create_allocation` also raises against `non_field`, `effective_to` and
 * `staff` (the "must be active teaching staff" rule), none of which this form
 * renders — those go to the "root" bucket instead of vanishing silently. Mirrors
 * staff/map-field-errors.ts exactly. */
const KNOWN_FIELDS = new Set<keyof AllocationFormValues>([
  "academic_session_id",
  "section_id",
  "subject_id",
  "staff_id",
  "is_primary",
  "weekly_periods",
  "effective_from",
]);

export function mapAllocationFieldErrors(fieldErrors: Record<string, string>): {
  known: Partial<Record<keyof AllocationFormValues, string>>;
  unknown: string[];
} {
  const known: Partial<Record<keyof AllocationFormValues, string>> = {};
  const unknown: string[] = [];

  for (const [field, issue] of Object.entries(fieldErrors)) {
    if (KNOWN_FIELDS.has(field as keyof AllocationFormValues)) {
      known[field as keyof AllocationFormValues] = issue;
    } else {
      unknown.push(issue);
    }
  }

  return { known, unknown };
}
