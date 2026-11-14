import { collectPages, fetchPage, MAX_PAGE_SIZE } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toExpenseCategoriesQueryParams, toExpenseCategoryBody } from "./expense-categories-helper";
import type {
  ExpenseCategoriesQuery,
  ExpenseCategoryInput,
  ExpenseCategoryRecord,
} from "./expense-categories-type";

/** The expense-categories API calls (`/expense-categories`), reached through `Services.expenseCategories.*`. */

export async function listExpenseCategories(
  query: ExpenseCategoriesQuery = {},
): Promise<Page<ExpenseCategoryRecord>> {
  return fetchPage<ExpenseCategoryRecord>(apiClient, endpoints.expenseCategories.list, {
    query: toExpenseCategoriesQueryParams(query),
  });
}

/** Every category matching the filters, for a picker or a name lookup: all pages, in code order. */
export async function fetchExpenseCategoryOptions(
  query: Pick<ExpenseCategoriesQuery, "isActive"> = {},
): Promise<ExpenseCategoryRecord[]> {
  return collectPages<ExpenseCategoryRecord>(apiClient, endpoints.expenseCategories.list, {
    query: toExpenseCategoriesQueryParams({ ...query, ordering: "code", pageSize: MAX_PAGE_SIZE }),
  });
}

/** Adds a category (`fees.expense.create`). A ledger account that is not an expense account is a 422 under `ledger_account`. */
export async function createExpenseCategory(
  input: ExpenseCategoryInput,
): Promise<ExpenseCategoryRecord> {
  const { data } = await apiClient.post<ExpenseCategoryRecord>(
    endpoints.expenseCategories.list,
    toExpenseCategoryBody(input),
  );
  return data;
}

export async function updateExpenseCategory(
  id: string,
  input: Partial<ExpenseCategoryInput>,
): Promise<ExpenseCategoryRecord> {
  const { data } = await apiClient.patch<ExpenseCategoryRecord>(
    endpoints.expenseCategories.detail(id),
    toExpenseCategoryBody(input),
  );
  return data;
}

/** Deletes a category. One with expenses or a budget filed against it is a 422 under `id`. */
export async function deleteExpenseCategory(id: string): Promise<void> {
  await apiClient.delete(endpoints.expenseCategories.detail(id));
}
