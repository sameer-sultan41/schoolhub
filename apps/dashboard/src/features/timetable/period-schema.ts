import { z } from "zod";

/** models.Period.name is `CharField(max_length=50)`. */
export const PERIOD_NAME_MAX_LENGTH = 50;

const TIME_PATTERN = /^\d{2}:\d{2}(:\d{2})?$/;

/**
 * Mirrors the API's period validations (§11) so the user gets instant feedback,
 * while the API remains the authority.
 *
 * `end_time > start_time` is a database CheckConstraint
 * (`periods_end_after_start`), so it is checked here too — an `<input type="time">`
 * makes reversing them trivially easy to do by accident.
 *
 * The rule only the server can check is the one that matters most: periods must
 * not overlap within a day template. `services.assert_period_does_not_overlap`
 * compares against the campus's own periods *and* the tenant-wide ones, which
 * needs rows this form has not got, and its message names the clashing period —
 * far more useful than anything a client could synthesise. It arrives against
 * `start_time` through `ApiError.fieldErrors()`.
 *
 * NOTE: plain English messages rather than translation keys, as elsewhere in
 * this app — there is no established pattern yet for translating client-side
 * Zod/RHF messages.
 */
export const periodSchema = z
  .object({
    campus_id: z.string(),
    name: z
      .string()
      .min(1, "A period needs a name.")
      .max(PERIOD_NAME_MAX_LENGTH, `A name may be at most ${PERIOD_NAME_MAX_LENGTH} characters.`),
    // The column is a PositiveSmallIntegerField and the help text says "1-based".
    sequence: z.string().refine((value) => /^\d+$/.test(value) && Number(value) >= 1, {
      message: "The daily order must be a whole number of at least 1.",
    }),
    start_time: z.string().regex(TIME_PATTERN, "Enter a start time."),
    end_time: z.string().regex(TIME_PATTERN, "Enter an end time."),
    is_break: z.boolean(),
    /** 0-6. Empty means "the tenant's working days", which the column stores as
     * NULL — not as an empty list, which would mean "never". */
    weekdays: z.array(z.number()),
  })
  .refine((values) => values.end_time > values.start_time, {
    path: ["end_time"],
    message: "The end time must be after the start time.",
  });

export type PeriodFormValues = z.infer<typeof periodSchema>;
