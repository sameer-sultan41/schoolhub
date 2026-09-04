import type { StaffFormValues } from "@/features/staff/staff-schema";

/** Whitelist of server field names the form actually has an input for.
 * ApiError.fieldErrors() returns whatever the server names; a field the form
 * doesn't recognise (e.g. a field this form doesn't render) goes to the
 * "root" bucket instead of vanishing silently. Mirrors
 * students/map-field-errors.ts exactly. */
const KNOWN_FIELDS = new Set<keyof StaffFormValues>([
  "first_name",
  "last_name",
  "gender",
  "date_of_birth",
  "staff_type",
  "campus_id",
  "department_id",
  "designation_id",
  "employment_type",
  "joining_date",
  "email",
  "phone",
  "national_id",
  "public_bio",
]);

export function mapFieldErrors(fieldErrors: Record<string, string>): {
  known: Partial<Record<keyof StaffFormValues, string>>;
  unknown: string[];
} {
  const known: Partial<Record<keyof StaffFormValues, string>> = {};
  const unknown: string[] = [];

  for (const [field, issue] of Object.entries(fieldErrors)) {
    if (KNOWN_FIELDS.has(field as keyof StaffFormValues)) {
      known[field as keyof StaffFormValues] = issue;
    } else {
      unknown.push(issue);
    }
  }

  return { known, unknown };
}
