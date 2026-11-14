import { z } from "zod";

import { EXPENSE_PAYMENT_METHODS, EXPENSE_VENDOR_MAX } from "./expenses-constant";
import type { ExpensePaymentMethod } from "./expenses-type";

/** The expense form's schema, with the API's own field names. */

export type ExpenseFormMessages = Record<"required" | "invalidAmount", string>;

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

/** Amounts are kept as typed text and sent as is: the server owns the decimal. `campus` and `payment_method` are `""` for none. */
export function createExpenseFormSchema(messages: ExpenseFormMessages) {
  return z.object({
    expense_category: z.string().min(1, messages.required),
    campus: z.string(),
    vendor_name: z.string().trim().max(EXPENSE_VENDOR_MAX),
    description: z.string().trim().min(1, messages.required),
    amount: z
      .string()
      .trim()
      .min(1, messages.required)
      .refine(
        (value) => value === "" || (AMOUNT_PATTERN.test(value) && Number(value) > 0),
        messages.invalidAmount,
      ),
    tax_amount: z
      .string()
      .trim()
      .refine((value) => value === "" || AMOUNT_PATTERN.test(value), messages.invalidAmount),
    expense_date: z.string().min(1, messages.required),
    payment_method: z.union([
      z.literal(""),
      z.custom<ExpensePaymentMethod>((value) =>
        EXPENSE_PAYMENT_METHODS.includes(value as ExpensePaymentMethod),
      ),
    ]),
  });
}
export const expenseFormSchema = createExpenseFormSchema({
  required: "required",
  invalidAmount: "invalidAmount",
});
export type ExpenseFormValues = z.infer<typeof expenseFormSchema>;
