import { z } from "zod";

import { FINE_REASON_MAX, FINE_TYPES } from "./fines-constant";
import type { FineType } from "./fines-type";

/** The fine forms' schemas, with the API's own field names. */

export type FineFormMessages = Record<"required" | "invalidAmount", string>;
export const FINE_FORM_MESSAGE_KEYS: FineFormMessages = {
  required: "required",
  invalidAmount: "invalidAmount",
};

const typeEnum = z.enum(FINE_TYPES as [FineType, ...FineType[]]);

/** The amount is kept as the typed text and sent as is: the server owns the decimal. It must be positive. */
export function createFineFormSchema(messages: FineFormMessages) {
  return z
    .object({
      student: z.string().min(1, messages.required),
      fee_head: z.string().min(1, messages.required),
      fine_type: typeEnum,
      amount: z.string().trim().min(1, messages.required),
      reason: z.string().trim().min(1, messages.required).max(FINE_REASON_MAX),
    })
    .superRefine((values, context) => {
      const amount = Number(values.amount);
      if (values.amount.trim() !== "" && (Number.isNaN(amount) || amount <= 0)) {
        context.addIssue({ code: "custom", path: ["amount"], message: messages.invalidAmount });
      }
    });
}
export const fineFormSchema = createFineFormSchema(FINE_FORM_MESSAGE_KEYS);
export type FineFormValues = z.infer<typeof fineFormSchema>;

export function createWaiveFineFormSchema(messages: Pick<FineFormMessages, "required">) {
  return z.object({
    reason: z.string().trim().min(1, messages.required).max(FINE_REASON_MAX),
  });
}
export const waiveFineFormSchema = createWaiveFineFormSchema({ required: "required" });
export type WaiveFineFormValues = z.infer<typeof waiveFineFormSchema>;
