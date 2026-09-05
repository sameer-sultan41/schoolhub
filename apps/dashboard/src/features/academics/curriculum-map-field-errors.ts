import type { CurriculumFormValues } from "@/features/academics/curriculum-schema";

/** Whitelist of server field names the curriculum form actually has an input for.
 * `ApiError.fieldErrors()` returns whatever the server names — `term_plans`,
 * `syllabus_file_id` and `non_field` all reach this form without a matching
 * control — so anything unrecognised goes to the "root" bucket instead of
 * vanishing silently. Mirrors staff/map-field-errors.ts exactly. */
const KNOWN_FIELDS = new Set<keyof CurriculumFormValues>([
  "academic_session_id",
  "class_id",
  "subject_id",
  "campus_id",
  "is_elective",
  "elective_group",
  "weekly_periods",
  "notes",
]);

export function mapCurriculumFieldErrors(fieldErrors: Record<string, string>): {
  known: Partial<Record<keyof CurriculumFormValues, string>>;
  unknown: string[];
} {
  const known: Partial<Record<keyof CurriculumFormValues, string>> = {};
  const unknown: string[] = [];

  for (const [field, issue] of Object.entries(fieldErrors)) {
    if (KNOWN_FIELDS.has(field as keyof CurriculumFormValues)) {
      known[field as keyof CurriculumFormValues] = issue;
    } else {
      unknown.push(issue);
    }
  }

  return { known, unknown };
}
