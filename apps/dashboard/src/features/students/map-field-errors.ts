import type { StudentFormValues } from "@/features/students/student-schema";

/** Whitelist of server field names the form actually has an input for.
 * ApiError.fieldErrors() returns whatever the server names; a field the form
 * doesn't recognise (a nested address.* path, a field this form doesn't
 * render) goes to the "root" bucket instead of vanishing silently. */
const KNOWN_FIELDS = new Set<keyof StudentFormValues>([
  "first_name",
  "last_name",
  "preferred_name",
  "date_of_birth",
  "gender",
  "campus_id",
  "house_id",
  "admission_date",
  "blood_group",
  "nationality",
  "religion",
  "previous_school",
  "medical_notes",
]);

export function mapFieldErrors(fieldErrors: Record<string, string>): {
  known: Partial<Record<keyof StudentFormValues, string>>;
  unknown: string[];
} {
  const known: Partial<Record<keyof StudentFormValues, string>> = {};
  const unknown: string[] = [];

  for (const [field, issue] of Object.entries(fieldErrors)) {
    if (KNOWN_FIELDS.has(field as keyof StudentFormValues)) {
      known[field as keyof StudentFormValues] = issue;
    } else {
      unknown.push(issue);
    }
  }

  return { known, unknown };
}
