import type { SubstitutionFormValues } from "@/features/timetable/substitution-schema";

/**
 * Whitelist of server field names the substitution form actually has an input for.
 *
 * `services.assert_substitution_valid` also raises against `absent_staff_id`
 * ("This teacher is not the one scheduled for that slot") — which this form does
 * NOT render, because the absent teacher is derived from the picked slot rather
 * than chosen. That message still has to reach the user, so like every other
 * unmapped field it lands in the "root" bucket instead of vanishing into a
 * `setError` for an input that does not exist. Mirrors
 * academics/allocation-map-field-errors.ts exactly.
 */
const KNOWN_FIELDS = new Set<keyof SubstitutionFormValues>([
  "timetable_slot_id",
  "date",
  "substitute_staff_id",
  "reason",
]);

export function mapSubstitutionFieldErrors(fieldErrors: Record<string, string>): {
  known: Partial<Record<keyof SubstitutionFormValues, string>>;
  unknown: string[];
} {
  const known: Partial<Record<keyof SubstitutionFormValues, string>> = {};
  const unknown: string[] = [];

  for (const [field, issue] of Object.entries(fieldErrors)) {
    if (KNOWN_FIELDS.has(field as keyof SubstitutionFormValues)) {
      known[field as keyof SubstitutionFormValues] = issue;
    } else {
      unknown.push(issue);
    }
  }

  return { known, unknown };
}
