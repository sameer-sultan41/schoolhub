import type { SlotFormValues } from "@/features/timetable/slot-schema";

/**
 * Whitelist of server field names the slot editor actually has an input for.
 *
 * `services.assert_staff_is_active_teacher` raises against `staff_id`, which is
 * here. Everything else the write path can name — `non_field`, `section_id`,
 * `period_id`, `day_of_week`, `academic_session_id` — is a cell coordinate the
 * dialog does not render, so those go to the "root" bucket rather than vanishing
 * silently into a `setError` for a field that does not exist. Mirrors
 * academics/allocation-map-field-errors.ts exactly.
 */
const KNOWN_FIELDS = new Set<keyof SlotFormValues>(["subject_id", "staff_id", "room_id", "notes"]);

export function mapSlotFieldErrors(fieldErrors: Record<string, string>): {
  known: Partial<Record<keyof SlotFormValues, string>>;
  unknown: string[];
} {
  const known: Partial<Record<keyof SlotFormValues, string>> = {};
  const unknown: string[] = [];

  for (const [field, issue] of Object.entries(fieldErrors)) {
    if (KNOWN_FIELDS.has(field as keyof SlotFormValues)) {
      known[field as keyof SlotFormValues] = issue;
    } else {
      unknown.push(issue);
    }
  }

  return { known, unknown };
}
