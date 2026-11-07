import { z } from "zod";

import { FEE_INVOICE_REASON_MAX } from "./fee-invoices-constant";

/** The invoice forms' schemas, with the API's own field names. */

export type FeeInvoiceFormMessages = Record<"required", string>;

/** Generate: a structure and one period, a calendar month (`period_start`, `YYYY-MM` from a month input) or a term (`term`). */
export function createGenerateInvoicesFormSchema(messages: FeeInvoiceFormMessages) {
  return z
    .object({
      fee_structure: z.string().min(1, messages.required),
      by: z.enum(["month", "term"]),
      period_start: z.string(),
      term: z.string(),
    })
    .superRefine((values, context) => {
      if (values.by === "month" && !values.period_start) {
        context.addIssue({ code: "custom", path: ["period_start"], message: messages.required });
      }
      if (values.by === "term" && !values.term) {
        context.addIssue({ code: "custom", path: ["term"], message: messages.required });
      }
    });
}
export const generateInvoicesFormSchema = createGenerateInvoicesFormSchema({
  required: "required",
});
export type GenerateInvoicesFormValues = z.infer<typeof generateInvoicesFormSchema>;

export function createCancelInvoiceFormSchema(messages: FeeInvoiceFormMessages) {
  return z.object({
    reason: z.string().trim().min(1, messages.required).max(FEE_INVOICE_REASON_MAX),
  });
}
export const cancelInvoiceFormSchema = createCancelInvoiceFormSchema({ required: "required" });
export type CancelInvoiceFormValues = z.infer<typeof cancelInvoiceFormSchema>;
