import { z } from "zod";
import { weightageSchema } from "@/services/modules/exams/exams.schema";
import { MARKS_PATTERN } from "./exam-subjects-constant";

/** The exam-subject form's schema, with the API's own field names. */

export type ExamSubjectFormMessages = Record<
  "required" | "marksInvalid" | "weightageInvalid" | "passAboveMax" | "windowOrder",
  string
>;
export const EXAM_SUBJECT_FORM_MESSAGE_KEYS: ExamSubjectFormMessages = {
  required: "required",
  marksInvalid: "marksInvalid",
  weightageInvalid: "weightageInvalid",
  passAboveMax: "passAboveMax",
  windowOrder: "windowOrder",
};

function optionalMarks(message: string) {
  return z
    .string()
    .refine((value) => value.trim() === "" || MARKS_PATTERN.test(value.trim()), message);
}

/** Marks are strings (a decimal the column can store, or blank for an optional one). The
 * practical maximum is required once the subject has a practical part, as on the server
 * (`services.assert_practical_marks`); pass above max and a window that closes before it opens
 * are refused here too, under the field the server names. */
export function createExamSubjectFormSchema(messages: ExamSubjectFormMessages) {
  return z
    .object({
      class_id: z.string().min(1, messages.required),
      subject_id: z.string().min(1, messages.required),
      max_marks: z.string().trim().regex(MARKS_PATTERN, messages.marksInvalid),
      pass_marks: z.string().trim().regex(MARKS_PATTERN, messages.marksInvalid),
      has_practical: z.boolean(),
      practical_max_marks: optionalMarks(messages.marksInvalid),
      practical_pass_marks: optionalMarks(messages.marksInvalid),
      subject_weightage_percent: weightageSchema(messages.weightageInvalid),
      marks_entry_opens_at: z.string(),
      marks_entry_closes_at: z.string(),
    })
    .superRefine((values, context) => {
      const issue = (path: string, message: string) => {
        context.addIssue({ code: "custom", path: [path], message });
      };
      if (Number(values.pass_marks) > Number(values.max_marks)) {
        issue("pass_marks", messages.passAboveMax);
      }
      if (values.has_practical) {
        if (values.practical_max_marks.trim() === "") {
          issue("practical_max_marks", messages.required);
        } else if (
          values.practical_pass_marks.trim() !== "" &&
          Number(values.practical_pass_marks) > Number(values.practical_max_marks)
        ) {
          issue("practical_pass_marks", messages.passAboveMax);
        }
      }
      const { marks_entry_opens_at: opens, marks_entry_closes_at: closes } = values;
      if (opens !== "" && closes !== "" && closes <= opens) {
        issue("marks_entry_closes_at", messages.windowOrder);
      }
    });
}

export const examSubjectFormSchema = createExamSubjectFormSchema(EXAM_SUBJECT_FORM_MESSAGE_KEYS);

export type ExamSubjectFormValues = z.infer<typeof examSubjectFormSchema>;
