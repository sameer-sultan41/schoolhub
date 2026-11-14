import { z } from "zod";

import {
  SCHOLARSHIP_COVERAGES,
  SCHOLARSHIP_INITIAL_STATUSES,
  SCHOLARSHIP_NAME_MAX,
  SCHOLARSHIP_NOTES_MAX,
  SCHOLARSHIP_SPONSOR_MAX,
  SCHOLARSHIP_TYPES,
} from "./scholarships-constant";
import type { ScholarshipCoverage, ScholarshipStatus, ScholarshipType } from "./scholarships-type";

/** The scholarship forms' schemas, with the API's own field names. */

export type ScholarshipFormMessages = Record<"required" | "invalidValue", string>;
export const SCHOLARSHIP_FORM_MESSAGE_KEYS: ScholarshipFormMessages = {
  required: "required",
  invalidValue: "invalidValue",
};

const PERCENT_MAX = 100;
const typeEnum = z.enum(SCHOLARSHIP_TYPES as [ScholarshipType, ...ScholarshipType[]]);
const coverageEnum = z.enum(
  SCHOLARSHIP_COVERAGES as [ScholarshipCoverage, ...ScholarshipCoverage[]],
);
const initialStatusEnum = z.enum(
  SCHOLARSHIP_INITIAL_STATUSES as [ScholarshipStatus, ...ScholarshipStatus[]],
);

/** The value is kept as the typed text and sent as is: the server owns the decimal. It must be positive, and a percent at most 100. */
export function createScholarshipFormSchema(messages: ScholarshipFormMessages) {
  return z
    .object({
      student: z.string().min(1, messages.required),
      academic_session: z.string().min(1, messages.required),
      name: z.string().trim().min(1, messages.required).max(SCHOLARSHIP_NAME_MAX),
      scholarship_type: typeEnum,
      coverage_type: coverageEnum,
      value: z.string().trim().min(1, messages.required),
      sponsor: z.string().trim().max(SCHOLARSHIP_SPONSOR_MAX),
      status: initialStatusEnum,
      notes: z.string().trim().max(SCHOLARSHIP_NOTES_MAX),
    })
    .superRefine((values, context) => {
      const value = Number(values.value);
      const tooBig = values.coverage_type === "percent" && value > PERCENT_MAX;
      if (values.value.trim() !== "" && (Number.isNaN(value) || value <= 0 || tooBig)) {
        context.addIssue({ code: "custom", path: ["value"], message: messages.invalidValue });
      }
    });
}
export const scholarshipFormSchema = createScholarshipFormSchema(SCHOLARSHIP_FORM_MESSAGE_KEYS);
export type ScholarshipFormValues = z.infer<typeof scholarshipFormSchema>;

/** The status dialog: notes are optional, except when `notesRequired` (ending or revoking). */
export function createScholarshipStatusFormSchema(
  messages: Pick<ScholarshipFormMessages, "required">,
  notesRequired: boolean,
) {
  const notes = z.string().trim().max(SCHOLARSHIP_NOTES_MAX);
  return z.object({
    notes: notesRequired ? notes.min(1, messages.required) : notes,
  });
}
export const scholarshipStatusFormSchema = createScholarshipStatusFormSchema(
  { required: "required" },
  false,
);
export type ScholarshipStatusFormValues = z.infer<typeof scholarshipStatusFormSchema>;
