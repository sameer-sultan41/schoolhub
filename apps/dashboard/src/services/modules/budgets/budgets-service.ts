import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toBudgetBody, toBudgetsQueryParams } from "./budgets-helper";
import type { BudgetInput, BudgetRecord, BudgetsQuery } from "./budgets-type";

/** The budgets API calls (`/budgets`, `fees.expense.view`), reached through `Services.budgets.*`. There is no delete. */

export async function listBudgets(query: BudgetsQuery = {}): Promise<Page<BudgetRecord>> {
  return fetchPage<BudgetRecord>(apiClient, endpoints.budgets.list, {
    query: toBudgetsQueryParams(query),
  });
}

/** Adds a draft budget (`fees.budget.create`). Naming both or neither of account and category is a 422. */
export async function createBudget(input: BudgetInput): Promise<BudgetRecord> {
  const { data } = await apiClient.post<BudgetRecord>(endpoints.budgets.list, toBudgetBody(input));
  return data;
}

export async function updateBudget(id: string, input: Partial<BudgetInput>): Promise<BudgetRecord> {
  const { data } = await apiClient.patch<BudgetRecord>(
    endpoints.budgets.detail(id),
    toBudgetBody(input),
  );
  return data;
}

/** Approves a draft budget (`fees.budget.approve`, the owner alone): only an approved one appears in the variance report. */
export async function approveBudget(id: string): Promise<BudgetRecord> {
  const { data } = await apiClient.post<BudgetRecord>(endpoints.budgets.approve(id));
  return data;
}
