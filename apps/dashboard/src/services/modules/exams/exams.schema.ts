import { z } from "zod";
import {
  EXAM_DESCRIPTION_MAX,
  EXAM_NAME_MAX,
  EXAM_TYPES,
  WEIGHTAGE_PATTERN,
} from "./exams-constant";
import type { ExamType } from "./exams-type";

/** The exam form's schema, with the API's own field names. */

export type ExamFormMessages = Record<
  "required" | "weightageInvalid" | "endsBeforeStart" | "bothDates",
  string
>;
export const EXAM_FORM_MESSAGE_KEYS: ExamFormMessages = {
  required: "required",
  weightageInvalid: "weightageInvalid",
  endsBeforeStart: "endsBeforeStart",
  bothDates: "bothDates",
};

/** Ids, dates and the weightage are strings: a blank is a real answer for the optional ones.
 * Both dates or neither, and the end not before the start, are the server's rules too
 * (`ExamSerializer.validate`); checked here so the message lands under the field before a trip. */
export function createExamFormSchema(messages: ExamFormMessages) {
  return z
    .object({
      name: z.string().trim().min(1, messages.required).max(EXAM_NAME_MAX),
      academic_session_id: z.string().min(1, messages.required),
      term_id: z.string(),
      exam_type: z.enum(EXAM_TYPES as [ExamType, ...ExamType[]]),
      grading_scale_id: z.string(),
      weightage_percent: z.string().trim().regex(WEIGHTAGE_PATTERN, messages.weightageInvalid),
      starts_on: z.string(),
      ends_on: z.string(),
      description: z.string().max(EXAM_DESCRIPTION_MAX),
    })
    .superRefine((values, context) => {
      const hasStart = values.starts_on !== "";
      const hasEnd = values.ends_on !== "";
      if (hasStart !== hasEnd) {
        context.addIssue({
          code: "custom",
          path: [hasStart ? "ends_on" : "starts_on"],
          message: messages.bothDates,
        });
      } else if (hasStart && values.ends_on < values.starts_on) {
        context.addIssue({ code: "custom", path: ["ends_on"], message: messages.endsBeforeStart });
      }
    });
}

export const examFormSchema = createExamFormSchema(EXAM_FORM_MESSAGE_KEYS);

export type ExamFormValues = z.infer<typeof examFormSchema>;
