import { z } from "zod";

/** The sitting form's schema, with the API's own field names. Times are `HH:MM`, so they compare
 * as text. */

export type SittingFormMessages = Record<"required" | "endBeforeStart", string>;
export const SITTING_FORM_MESSAGE_KEYS: SittingFormMessages = {
  required: "required",
  endBeforeStart: "endBeforeStart",
};

export function createSittingFormSchema(messages: SittingFormMessages) {
  return z
    .object({
      exam_subject_id: z.string().min(1, messages.required),
      section_id: z.string().min(1, messages.required),
      exam_date: z.string().min(1, messages.required),
      start_time: z.string().min(1, messages.required),
      end_time: z.string().min(1, messages.required),
      room_id: z.string(),
      invigilator_staff_id: z.string(),
    })
    .superRefine((values, context) => {
      const { start_time: start, end_time: end } = values;
      if (start !== "" && end !== "" && end <= start) {
        context.addIssue({ code: "custom", path: ["end_time"], message: messages.endBeforeStart });
      }
    });
}

export const sittingFormSchema = createSittingFormSchema(SITTING_FORM_MESSAGE_KEYS);

export type SittingFormValues = z.infer<typeof sittingFormSchema>;
