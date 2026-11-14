import { z } from "zod";

import { BUDGET_NAME_MAX, BUDGET_TARGETS } from "./budgets-constant";

/** The budget form's schema, with the API's own field names plus `target` (which of account/category). */

export type BudgetFormMessages = Record<"required" | "invalidAmount" | "periodOrder", string>;

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

export function createBudgetFormSchema(messages: BudgetFormMessages) {
  return z
    .object({
      name: z.string().trim().min(1, messages.required).max(BUDGET_NAME_MAX),
      target: z.enum(BUDGET_TARGETS),
      target_id: z.string().min(1, messages.required),
      campus: z.string(),
      period_start: z.string().min(1, messages.required),
      period_end: z.string().min(1, messages.required),
      amount: z
        .string()
        .trim()
        .min(1, messages.required)
        .refine(
          (value) => value === "" || (AMOUNT_PATTERN.test(value) && Number(value) > 0),
          messages.invalidAmount,
        ),
      notes: z.string().trim(),
    })
    .refine((v) => v.period_start === "" || v.period_end === "" || v.period_end >= v.period_start, {
      message: messages.periodOrder,
      path: ["period_end"],
    });
}
export const budgetFormSchema = createBudgetFormSchema({
  required: "required",
  invalidAmount: "invalidAmount",
  periodOrder: "periodOrder",
});
export type BudgetFormValues = z.infer<typeof budgetFormSchema>;
