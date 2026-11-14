import { z } from "zod";

import {
  COUNTER_PAYMENT_METHODS,
  DEFAULT_COUNTER_METHOD,
} from "@/services/modules/payments/payments-constant";
import type { CounterPaymentMethod } from "@/services/modules/payments/payments-type";
import { REFUND_NOTE_MAX, REFUND_REASON_MAX, REFUND_REFERENCE_MAX } from "./refunds-constant";

/** The refund forms' schemas, with the API's own field names. */

export type RefundFormMessages = Record<"required" | "positive", string>;

/** A positive amount with at most two decimals; the remainder check is the server's. */
const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

export function createRequestRefundFormSchema(messages: RefundFormMessages) {
  return z.object({
    amount: z
      .string()
      .trim()
      .min(1, messages.required)
      .refine(
        (value) => value === "" || (AMOUNT_PATTERN.test(value) && Number(value) > 0),
        messages.positive,
      ),
    reason: z.string().trim().min(1, messages.required).max(REFUND_REASON_MAX),
  });
}
export const requestRefundFormSchema = createRequestRefundFormSchema({
  required: "required",
  positive: "positive",
});
export type RequestRefundFormValues = z.infer<typeof requestRefundFormSchema>;

/** A note is optional on approval and asked for on a rejection (`requireNote`). */
export function createRefundDecisionFormSchema(
  messages: { required: string },
  requireNote: boolean,
) {
  return z.object({
    note: requireNote
      ? z.string().trim().min(1, messages.required).max(REFUND_NOTE_MAX)
      : z.string().trim().max(REFUND_NOTE_MAX),
  });
}
export const refundDecisionFormSchema = createRefundDecisionFormSchema(
  { required: "required" },
  false,
);
export type RefundDecisionFormValues = z.infer<typeof refundDecisionFormSchema>;

export function createProcessRefundFormSchema(messages: { required: string }) {
  return z.object({
    method: z.custom<CounterPaymentMethod>(
      (value) => COUNTER_PAYMENT_METHODS.includes(value as CounterPaymentMethod),
      messages.required,
    ),
    reference_no: z.string().trim().max(REFUND_REFERENCE_MAX),
  });
}
export const processRefundFormSchema = createProcessRefundFormSchema({ required: "required" });
export type ProcessRefundFormValues = z.infer<typeof processRefundFormSchema>;

export function defaultProcessRefundFormValues(): ProcessRefundFormValues {
  return { method: DEFAULT_COUNTER_METHOD, reference_no: "" };
}
