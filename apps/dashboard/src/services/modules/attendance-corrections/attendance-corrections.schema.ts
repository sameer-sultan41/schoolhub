import { z } from "zod";

import { ATTENDANCE_REMARKS_MAX_LENGTH } from "@/services/modules/student-attendance/student-attendance-constant";
import { isMarkableStatus } from "@/services/modules/student-attendance/student-attendance-helper";
import type { MarkableStatus } from "@/services/modules/student-attendance/student-attendance-type";
import { CORRECTION_REASON_MAX_LENGTH } from "./attendance-corrections-constant";

/**
 * The request-correction form, with the API's own field names so a server error lands under
 * its input. `status` is `""` only for a record whose own status no correction may set
 * (`on_leave`), until a status is picked.
 */

export type CorrectionFormMessages = Record<
  "reasonRequired" | "reasonTooLong" | "remarksTooLong",
  string
>;

export const CORRECTION_FORM_MESSAGE_KEYS: CorrectionFormMessages = {
  reasonRequired: "reasonRequired",
  reasonTooLong: "reasonTooLong",
  remarksTooLong: "remarksTooLong",
};

export function createCorrectionFormSchema(messages: CorrectionFormMessages) {
  return z.object({
    new_values: z.object({
      status: z.custom<MarkableStatus | "">(
        (value) => value === "" || (typeof value === "string" && isMarkableStatus(value)),
      ),
      check_in_time: z.string(),
      check_out_time: z.string(),
      remarks: z.string().max(ATTENDANCE_REMARKS_MAX_LENGTH, messages.remarksTooLong),
    }),
    reason: z
      .string()
      .refine((value) => value.trim() !== "", messages.reasonRequired)
      .refine(
        (value) => value.trim().length <= CORRECTION_REASON_MAX_LENGTH,
        messages.reasonTooLong,
      ),
  });
}

export const correctionFormSchema = createCorrectionFormSchema(CORRECTION_FORM_MESSAGE_KEYS);

export type CorrectionFormValues = z.infer<typeof correctionFormSchema>;
