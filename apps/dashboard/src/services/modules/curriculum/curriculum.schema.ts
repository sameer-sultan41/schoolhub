import { z } from "zod";
import { Regex } from "@/lib/regex";
import {
  CURRICULUM_ELECTIVE_GROUP_MAX,
  CURRICULUM_MIN_WEEKLY_PERIODS,
  CURRICULUM_NOTES_MAX,
} from "./curriculum-constant";

/**
 * The curriculum module's Zod schemas. Field names are snake_case, matching the API's own, so
 * `error.fieldErrors()` keys map onto them with no re-mapping step.
 */

/** The validation messages a curriculum form can show. */
export type CurriculumFormMessages = Record<
  "required" | "electiveGroupRequired" | "weeklyPeriodsInvalid",
  string
>;

/** The messages as bare keys, for the module-level schema below. */
export const CURRICULUM_FORM_MESSAGE_KEYS: CurriculumFormMessages = {
  required: "required",
  electiveGroupRequired: "electiveGroupRequired",
  weeklyPeriodsInvalid: "weeklyPeriodsInvalid",
};

/**
 * The curriculum form's schema, with `messages` as the text a failed rule shows. Zod can't
 * reach next-intl, so the form dialog passes its translated messages in; everything else
 * (`curriculumFormSchema`, tests) uses the bare keys.
 *
 * `weekly_periods` is a plain `z.number()`, not `z.coerce.number()`: a coerced schema's input
 * type is `unknown`, which forces a three-generic `useForm` this codebase's `FormField` does
 * not forward. The number input sets a real number itself (`valueAsNumber`).
 */
export function createCurriculumFormSchema(messages: CurriculumFormMessages) {
  return z
    .object({
      academic_session_id: z.string().regex(Regex.UUID, messages.required),
      class_id: z.string().regex(Regex.UUID, messages.required),
      subject_id: z.string().regex(Regex.UUID, messages.required),
      /** `""` = all campuses; sent as `null`. */
      campus_id: z.string(),
      is_elective: z.boolean(),
      elective_group: z.string().max(CURRICULUM_ELECTIVE_GROUP_MAX),
      weekly_periods: z
        .number(messages.weeklyPeriodsInvalid)
        .int(messages.weeklyPeriodsInvalid)
        .min(CURRICULUM_MIN_WEEKLY_PERIODS, messages.weeklyPeriodsInvalid),
      notes: z.string().max(CURRICULUM_NOTES_MAX),
    })
    .refine((values) => !values.is_elective || values.elective_group.trim() !== "", {
      path: ["elective_group"],
      error: messages.electiveGroupRequired,
    });
}

export const curriculumFormSchema = createCurriculumFormSchema(CURRICULUM_FORM_MESSAGE_KEYS);

export type CurriculumFormValues = z.infer<typeof curriculumFormSchema>;

/** The clone form's schema; `required` is the text an unpicked session shows. */
export function createCloneCurriculumFormSchema(required: string) {
  return z.object({
    source_academic_session_id: z.string().regex(Regex.UUID, required),
    target_academic_session_id: z.string().regex(Regex.UUID, required),
  });
}

export type CloneCurriculumFormValues = z.infer<ReturnType<typeof createCloneCurriculumFormSchema>>;
