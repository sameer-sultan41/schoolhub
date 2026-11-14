import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toExpenseBody, toExpensesQueryParams, toReverseExpenseBody } from "./expenses-helper";
import type { ExpenseInput, ExpenseRecord, ExpensesQuery } from "./expenses-type";

/** The expenses API calls (`/expenses`, `fees.expense.view`), reached through `Services.expenses.*`. There is no delete: an expense is reversed, never removed. */

export async function listExpenses(query: ExpensesQuery = {}): Promise<Page<ExpenseRecord>> {
  return fetchPage<ExpenseRecord>(apiClient, endpoints.expenses.list, {
    query: toExpensesQueryParams(query),
  });
}

export async function fetchExpense(id: string): Promise<ExpenseRecord> {
  const { data } = await apiClient.get<ExpenseRecord>(endpoints.expenses.detail(id));
  return data;
}

/** Records a draft expense (`fees.expense.create`). */
export async function createExpense(input: ExpenseInput): Promise<ExpenseRecord> {
  const { data } = await apiClient.post<ExpenseRecord>(
    endpoints.expenses.list,
    toExpenseBody(input),
  );
  return data;
}

/** Edits a draft expense (`fees.expense.update`); any other status is a 422. */
export async function updateExpense(
  id: string,
  input: Partial<ExpenseInput>,
): Promise<ExpenseRecord> {
  const { data } = await apiClient.patch<ExpenseRecord>(
    endpoints.expenses.detail(id),
    toExpenseBody(input),
  );
  return data;
}

/** Puts a draft into the approval queue (`fees.expense.create`). */
export async function submitExpense(id: string): Promise<ExpenseRecord> {
  const { data } = await apiClient.post<ExpenseRecord>(endpoints.expenses.submit(id));
  return data;
}

/** Approves a submitted expense and posts it (`fees.expense.approve`). The submitter approving their own is a 422 under `approved_by`. */
export async function approveExpense(id: string): Promise<ExpenseRecord> {
  const { data } = await apiClient.post<ExpenseRecord>(endpoints.expenses.approve(id));
  return data;
}

export async function rejectExpense(id: string): Promise<ExpenseRecord> {
  const { data } = await apiClient.post<ExpenseRecord>(endpoints.expenses.reject(id));
  return data;
}

/** Records that an approved expense has been paid (`fees.expense.update`). Posts nothing further. */
export async function markExpensePaid(id: string): Promise<ExpenseRecord> {
  const { data } = await apiClient.post<ExpenseRecord>(endpoints.expenses.markPaid(id));
  return data;
}

/** Reverses an approved or paid expense (`fees.expense.approve`); the reason is required. */
export async function reverseExpense(id: string, reason: string): Promise<ExpenseRecord> {
  const { data } = await apiClient.post<ExpenseRecord>(
    endpoints.expenses.reverse(id),
    toReverseExpenseBody(reason),
  );
  return data;
}
