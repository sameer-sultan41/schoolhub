import { z } from "zod";

/**
 * Mirrors the API's curriculum validations (docs/03-modules/academics.md §11) so
 * the user gets instant feedback, while the API remains the authority — see
 * curriculum-form.tsx's ApiError.fieldErrors() handling for the rules only the
 * server can check (uniqueness per session/class/subject, "an elective group
 * needs at least two options", term plans belonging to the session's terms, and
 * the session lock on closed sessions).
 *
 * `weekly_periods` stays a string here on purpose: it is bound to an
 * `<input type="number">`, whose value is a string, and the string→number
 * conversion belongs in the mutation's `mutationFn` alongside the
 * empty-string→null conversions, not in the schema.
 *
 * NOTE: like staff-schema.ts's identical note, these messages are plain English,
 * not translation keys — this codebase has no established pattern yet for
 * translating client-side Zod/RHF messages.
 */
export const curriculumSchema = z
  .object({
    academic_session_id: z.string().min(1),
    class_id: z.string().min(1),
    subject_id: z.string().min(1),
    campus_id: z.string().optional().or(z.literal("")),
    is_elective: z.boolean(),
    elective_group: z.string().max(100).optional().or(z.literal("")),
    weekly_periods: z
      .string()
      .min(1)
      .refine((value) => /^\d+$/.test(value) && Number(value) >= 1, {
        message: "Weekly periods must be a whole number of at least 1.",
      }),
    notes: z.string().max(1000).optional().or(z.literal("")),
  })
  .refine((values) => !values.is_elective || Boolean(values.elective_group), {
    // §11: elective groups are how "choose 1 of 3" is expressed, so an elective
    // with no group name cannot be part of a choice at all.
    message: "An elective needs a group name.",
    path: ["elective_group"],
  });

export type CurriculumFormValues = z.infer<typeof curriculumSchema>;

/**
 * `POST /class-subjects:clone`. The one rule worth mirroring client-side is the
 * one the user can see for themselves — `services.clone_curriculum` rejects a
 * clone whose source and target are the same session. Everything else it
 * enforces (the target session must be writable, rows the target already has are
 * skipped) depends on server state this form cannot know.
 */
export const cloneCurriculumSchema = z
  .object({
    source_academic_session_id: z.string().min(1),
    target_academic_session_id: z.string().min(1),
  })
  .refine((values) => values.source_academic_session_id !== values.target_academic_session_id, {
    message: "Source and target sessions must differ.",
    path: ["target_academic_session_id"],
  });

export type CloneCurriculumFormValues = z.infer<typeof cloneCurriculumSchema>;
