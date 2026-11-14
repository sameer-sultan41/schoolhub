import { z } from "zod";

import {
  COUNTER_PAYMENT_METHODS,
  METHODS_NEEDING_REFERENCE,
  PAYMENT_REFERENCE_MAX,
} from "./payments-constant";
import type { CounterPaymentMethod } from "./payments-type";

/** The record-payment form's schema, with the API's own field names. */

export type RecordPaymentFormMessages = Record<"required" | "positive" | "reference", string>;

/** A positive amount with at most two decimals; the balance check is the server's. */
const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

export function createRecordPaymentFormSchema(messages: RecordPaymentFormMessages) {
  return z
    .object({
      amount: z
        .string()
        .trim()
        .min(1, messages.required)
        .refine((value) => AMOUNT_PATTERN.test(value) && Number(value) > 0, messages.positive),
      method: z.custom<CounterPaymentMethod>(
        (value) => COUNTER_PAYMENT_METHODS.includes(value as CounterPaymentMethod),
        messages.required,
      ),
      reference_no: z.string().trim().max(PAYMENT_REFERENCE_MAX),
    })
    .superRefine((values, context) => {
      if (METHODS_NEEDING_REFERENCE.includes(values.method) && !values.reference_no) {
        context.addIssue({ code: "custom", path: ["reference_no"], message: messages.reference });
      }
    });
}
export const recordPaymentFormSchema = createRecordPaymentFormSchema({
  required: "required",
  positive: "positive",
  reference: "reference",
});
export type RecordPaymentFormValues = z.infer<typeof recordPaymentFormSchema>;
