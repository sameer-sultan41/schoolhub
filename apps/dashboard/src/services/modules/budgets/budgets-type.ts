import type { ApiSchemas } from "@schoolhub/api-client";

/** A planned figure (`/budgets`, read with `fees.expense.view`): the generated wire shape (ADR-0017). */
export type BudgetRecord = ApiSchemas["Budget"];
export type BudgetStatus = ApiSchemas["BudgetStatusEnum"];

export interface BudgetsQuery {
  status?: BudgetStatus;
  campusId?: string;
  expenseCategoryId?: string;
  ledgerAccountId?: string;
  search?: string;
  ordering?: string;
  cursor?: string;
  pageSize?: number;
}

/** A create sends every field; an update sends only the fields given. Exactly one of `ledgerAccountId` and `expenseCategoryId` names the target (the server refuses both or neither). */
export interface BudgetInput {
  name: string;
  ledgerAccountId?: string | null;
  expenseCategoryId?: string | null;
  campusId?: string | null;
  periodStart: string;
  periodEnd: string;
  amount: string;
  notes?: string | null;
}
