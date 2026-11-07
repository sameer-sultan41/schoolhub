import { z } from "zod";

import { FEE_INVOICE_PERIOD_LABEL_MAX, FEE_INVOICE_REASON_MAX } from "./fee-invoices-constant";

/** The invoice forms' schemas, with the API's own field names. */

export type FeeInvoiceFormMessages = Record<"required" | "dueBeforeIssue", string>;
export const FEE_INVOICE_FORM_MESSAGE_KEYS: FeeInvoiceFormMessages = {
  required: "required",
  dueBeforeIssue: "dueBeforeIssue",
};

/** The ad-hoc invoice header. `period_label` is optional; the due date may not precede the issue date. */
export function createFeeInvoiceFormSchema(messages: FeeInvoiceFormMessages) {
  return z
    .object({
      student: z.string().min(1, messages.required),
      academic_session: z.string().min(1, messages.required),
      issue_date: z.string().min(1, messages.required),
      due_date: z.string().min(1, messages.required),
      period_label: z.string().trim().max(FEE_INVOICE_PERIOD_LABEL_MAX),
    })
    .refine(
      (values) => !values.issue_date || !values.due_date || values.due_date >= values.issue_date,
      {
        path: ["due_date"],
        message: messages.dueBeforeIssue,
      },
    );
}
export const feeInvoiceFormSchema = createFeeInvoiceFormSchema(FEE_INVOICE_FORM_MESSAGE_KEYS);
export type FeeInvoiceFormValues = z.infer<typeof feeInvoiceFormSchema>;

/** Generate: a structure and one period, a calendar month (`period_start`, `YYYY-MM` from a month input) or a term (`term`). */
export function createGenerateInvoicesFormSchema(
  messages: Pick<FeeInvoiceFormMessages, "required">,
) {
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

export function createCancelInvoiceFormSchema(messages: Pick<FeeInvoiceFormMessages, "required">) {
  return z.object({
    reason: z.string().trim().min(1, messages.required).max(FEE_INVOICE_REASON_MAX),
  });
}
export const cancelInvoiceFormSchema = createCancelInvoiceFormSchema({ required: "required" });
export type CancelInvoiceFormValues = z.infer<typeof cancelInvoiceFormSchema>;
