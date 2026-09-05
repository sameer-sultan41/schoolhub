import { z } from "zod";

/**
 * Mirrors the API's teacher-allocation validations (academics.md §11) so the user
 * gets instant feedback, while the API remains the authority. The rules only the
 * server can check are deliberately absent here: the teacher must be active
 * teaching staff, `(session, section, subject, teacher)` must not already exist,
 * exactly one primary teacher per `(section, subject)` may be current at a time,
 * and the subject must already be in that class's curriculum. Those all reach the
 * form through `ApiError.fieldErrors()` — see allocation-form.tsx.
 *
 * Load warnings are NOT a validation: `services.load_warnings` returns them in the
 * response body precisely so a grid being built up mid-way is still savable while
 * over norm.
 *
 * NOTE: like staff-schema.ts's identical note, these messages are plain English,
 * not translation keys — this codebase has no established pattern yet for
 * translating client-side Zod/RHF messages.
 */
export const allocationSchema = z.object({
  academic_session_id: z.string().min(1),
  section_id: z.string().min(1),
  subject_id: z.string().min(1),
  staff_id: z.string().min(1),
  is_primary: z.boolean(),
  // Blank means "inherit the class-subject's own weekly_periods" — the column is
  // nullable and documented as an override, so an empty box is a real choice.
  weekly_periods: z
    .string()
    .refine((value) => value === "" || (/^\d+$/.test(value) && Number(value) >= 1), {
      message: "Weekly periods must be a whole number of at least 1, or left blank.",
    }),
  effective_from: z.string().optional().or(z.literal("")),
});

export type AllocationFormValues = z.infer<typeof allocationSchema>;
