import { z } from "zod";

import {
  AMOUNT_PATTERN,
  DUE_DAY_MAX,
  DUE_DAY_MIN,
  FEE_FREQUENCIES,
} from "./fee-schedules-constant";
import type { FeeFrequency } from "./fee-schedules-type";

/** The schedule form's schema, with the API's own field names (`fee_head`, `due_day`, `due_date`).
 * Which of term, due day and due date a frequency needs is the server's rule: its sentence lands
 * under the field it names. */

const frequencyEnum = z.enum(FEE_FREQUENCIES as [FeeFrequency, ...FeeFrequency[]]);

export type FeeScheduleFormMessages = Record<
  "required" | "amountInvalid" | "dueDayInvalid",
  string
>;
export const FEE_SCHEDULE_FORM_MESSAGE_KEYS: FeeScheduleFormMessages = {
  required: "required",
  amountInvalid: "amountInvalid",
  dueDayInvalid: "dueDayInvalid",
};

/** `amount` and `due_day` are strings, so a cleared input is blank rather than NaN. */
export function createFeeScheduleFormSchema(messages: FeeScheduleFormMessages) {
  return z.object({
    fee_head: z.string().min(1, messages.required),
    amount: z.string().trim().regex(AMOUNT_PATTERN, messages.amountInvalid),
    frequency: frequencyEnum,
    term: z.string(),
    due_day: z
      .string()
      .trim()
      .refine(
        (value) =>
          value === "" ||
          (/^\d{1,2}$/.test(value) && Number(value) >= DUE_DAY_MIN && Number(value) <= DUE_DAY_MAX),
        messages.dueDayInvalid,
      ),
    due_date: z.string(),
  });
}

export const feeScheduleFormSchema = createFeeScheduleFormSchema(FEE_SCHEDULE_FORM_MESSAGE_KEYS);
export type FeeScheduleFormValues = z.infer<typeof feeScheduleFormSchema>;
