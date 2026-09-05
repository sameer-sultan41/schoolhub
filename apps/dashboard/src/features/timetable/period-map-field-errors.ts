import type { PeriodFormValues } from "@/features/timetable/period-schema";

/**
 * Whitelist of server field names the period form has an input for.
 *
 * `services.assert_period_does_not_overlap` raises against `start_time`, which is
 * here — that message names the period it clashes with, so routing it to the
 * start-time input puts it exactly where the user must act. The uniqueness
 * constraint on (tenant, campus, sequence) surfaces as `non_field` or as a 409,
 * neither of which is a field, so those reach the "root" bucket instead of
 * vanishing silently.
 */
const KNOWN_FIELDS = new Set<keyof PeriodFormValues>([
  "campus_id",
  "name",
  "sequence",
  "start_time",
  "end_time",
  "is_break",
  "weekdays",
]);

export function mapPeriodFieldErrors(fieldErrors: Record<string, string>): {
  known: Partial<Record<keyof PeriodFormValues, string>>;
  unknown: string[];
} {
  const known: Partial<Record<keyof PeriodFormValues, string>> = {};
  const unknown: string[] = [];

  for (const [field, issue] of Object.entries(fieldErrors)) {
    if (KNOWN_FIELDS.has(field as keyof PeriodFormValues)) {
      known[field as keyof PeriodFormValues] = issue;
    } else {
      unknown.push(issue);
    }
  }

  return { known, unknown };
}
