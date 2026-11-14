import { z } from "zod";

import {
  EXPENSE_CATEGORY_CODE_MAX,
  EXPENSE_CATEGORY_NAME_MAX,
} from "./expense-categories-constant";

/** The category form's schema, with the API's own field names. */

export type ExpenseCategoryFormMessages = Record<"required", string>;

export function createExpenseCategoryFormSchema(messages: ExpenseCategoryFormMessages) {
  return z.object({
    name: z.string().trim().min(1, messages.required).max(EXPENSE_CATEGORY_NAME_MAX),
    code: z.string().trim().min(1, messages.required).max(EXPENSE_CATEGORY_CODE_MAX),
    ledger_account: z.string().min(1, messages.required),
    is_active: z.boolean(),
  });
}
export const expenseCategoryFormSchema = createExpenseCategoryFormSchema({ required: "required" });
export type ExpenseCategoryFormValues = z.infer<typeof expenseCategoryFormSchema>;
