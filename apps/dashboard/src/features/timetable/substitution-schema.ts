import { z } from "zod";

/** models.TeacherSubstitution.reason is `CharField(max_length=200)`. */
export const SUBSTITUTION_REASON_MAX_LENGTH = 200;

/**
 * Mirrors what a client can meaningfully check of §11's substitution rules:
 * every required id is present and a reason fits the column.
 *
 * The rest are server-only by nature — the substitute must be *free* at that
 * (date, period), the date must fall on the slot's weekday and inside the
 * academic session, and the absent teacher must be the one actually scheduled.
 * All four need rows this client has not got, and all four arrive through
 * `ApiError.fieldErrors()`.
 *
 * Two constraints are handled by narrowing the *choices* instead of by
 * validating them: `absent_staff_id` is derived from the picked slot rather than
 * offered (services.assert_substitution_valid requires it to equal that slot's
 * own `staff_id`, so a field could only be a way to be wrong), and the absent
 * teacher is filtered out of the substitute list (the database's
 * `substitutions_substitute_differs_from_absentee` constraint).
 *
 * NOTE: as elsewhere in this app, these messages are plain English rather than
 * translation keys — there is no established pattern yet for translating
 * client-side Zod/RHF messages.
 */
export const substitutionSchema = z.object({
  timetable_slot_id: z.string().min(1, "Pick the class period to cover."),
  date: z.string().min(1, "Pick the date of the absence."),
  substitute_staff_id: z.string().min(1, "Pick the covering teacher."),
  reason: z
    .string()
    .max(
      SUBSTITUTION_REASON_MAX_LENGTH,
      `A reason may be at most ${SUBSTITUTION_REASON_MAX_LENGTH} characters.`,
    ),
});

export type SubstitutionFormValues = z.infer<typeof substitutionSchema>;
