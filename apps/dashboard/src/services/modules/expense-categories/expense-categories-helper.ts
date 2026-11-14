import type { QueryParams } from "@schoolhub/api-client";
import { FILTER_ALL } from "@/lib/constants";
import { copyMappedFields } from "@/lib/helpers";
import {
  EXPENSE_CATEGORIES_BODY_FIELDS,
  EXPENSE_CATEGORIES_QUERY_FIELDS,
} from "./expense-categories-constant";
import type { ExpenseCategoryFormValues } from "./expense-categories.schema";
import type {
  ExpenseCategoriesQuery,
  ExpenseCategoryInput,
  ExpenseCategoryRecord,
} from "./expense-categories-type";

/** The expense-categories module's pure helpers: plain data in, plain data out. */

/** The list's query string: only the filters given are sent. */
export function toExpenseCategoriesQueryParams(query: ExpenseCategoriesQuery): QueryParams {
  const params: Record<string, unknown> = {};
  copyMappedFields(
    query,
    EXPENSE_CATEGORIES_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as QueryParams;
}

/** A create or update body: only the fields given, in the API's snake_case. */
export function toExpenseCategoryBody(
  input: Partial<ExpenseCategoryInput>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, EXPENSE_CATEGORIES_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}

/** The `active` URL filter -> `is_active` (`undefined` for "all"). */
export function categoryActiveFilterToFlag(value: string): boolean | undefined {
  if (value === FILTER_ALL) return undefined;
  if (value === "active") return true;
  if (value === "inactive") return false;
  return undefined;
}

export function defaultExpenseCategoryFormValues(): ExpenseCategoryFormValues {
  return { name: "", code: "", ledger_account: "", is_active: true };
}

export function recordToExpenseCategoryFormValues(
  record: ExpenseCategoryRecord,
): ExpenseCategoryFormValues {
  return {
    name: record.name,
    code: record.code,
    ledger_account: record.ledger_account,
    is_active: record.is_active ?? true,
  };
}

export function buildExpenseCategoryInput(values: ExpenseCategoryFormValues): ExpenseCategoryInput {
  return {
    name: values.name.trim(),
    code: values.code.trim(),
    ledgerAccountId: values.ledger_account,
    isActive: values.is_active,
  };
}
