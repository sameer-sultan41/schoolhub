import type { ApiSchemas } from "@schoolhub/api-client";

/** The spend taxonomy (`/expense-categories`, read with `fees.expense.view`): the generated wire shape (ADR-0017). */
export type ExpenseCategoryRecord = ApiSchemas["ExpenseCategory"];

export interface ExpenseCategoriesQuery {
  search?: string;
  ordering?: string;
  isActive?: boolean;
  ledgerAccountId?: string;
  cursor?: string;
  pageSize?: number;
}

/** A create sends every field; an update sends only the fields given (a PATCH). */
export interface ExpenseCategoryInput {
  name: string;
  code: string;
  ledgerAccountId: string;
  isActive?: boolean;
}
