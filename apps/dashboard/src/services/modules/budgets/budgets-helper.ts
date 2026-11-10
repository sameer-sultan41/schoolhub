import type { QueryParams } from "@schoolhub/api-client";
import { FILTER_ALL } from "@/lib/constants";
import { copyMappedFields } from "@/lib/helpers";
import {
  BUDGET_STATUS_DRAFT,
  BUDGET_STATUSES,
  BUDGETS_BODY_FIELDS,
  BUDGETS_QUERY_FIELDS,
} from "./budgets-constant";
import type { BudgetFormValues } from "./budgets.schema";
import type { BudgetInput, BudgetRecord, BudgetsQuery, BudgetStatus } from "./budgets-type";

/** The budgets module's pure helpers: plain data in, plain data out. */

export function toBudgetsQueryParams(query: BudgetsQuery): QueryParams {
  const params: Record<string, unknown> = {};
  copyMappedFields(query, BUDGETS_QUERY_FIELDS, (v) => v !== undefined && v !== "", params);
  return params as QueryParams;
}

/** A create or update body: only the fields given, in the API's snake_case. */
export function toBudgetBody(input: Partial<BudgetInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, BUDGETS_BODY_FIELDS, (v) => v !== undefined, body);
  return body;
}

export function budgetStatusFilter(value: string): BudgetStatus | undefined {
  return value === FILTER_ALL ? undefined : BUDGET_STATUSES.find((s) => s === value);
}

/** Approve is offered only on a draft. */
export function canApproveBudget(budget: Pick<BudgetRecord, "status">): boolean {
  return budget.status === BUDGET_STATUS_DRAFT;
}

/** Edit is offered only while a draft (the server does not block it; an approved figure is not reopened from the UI). */
export function canEditBudget(budget: Pick<BudgetRecord, "status">): boolean {
  return budget.status === BUDGET_STATUS_DRAFT;
}

/** A budget set against a ledger account rather than an expense category (its form needs the ledger read to pick one). */
export function budgetTargetsAccount(
  budget: Pick<BudgetRecord, "ledger_account" | "expense_category">,
): boolean {
  return !budget.expense_category && !!budget.ledger_account;
}

export function defaultBudgetFormValues(): BudgetFormValues {
  return {
    name: "",
    target: "category",
    target_id: "",
    campus: "",
    period_start: "",
    period_end: "",
    amount: "",
    notes: "",
  };
}

export function recordToBudgetFormValues(record: BudgetRecord): BudgetFormValues {
  const byAccount = budgetTargetsAccount(record);
  return {
    name: record.name,
    target: byAccount ? "account" : "category",
    target_id: (byAccount ? record.ledger_account : record.expense_category) ?? "",
    campus: record.campus ?? "",
    period_start: record.period_start,
    period_end: record.period_end,
    amount: record.amount,
    notes: record.notes ?? "",
  };
}

/** Form values -> the service input: exactly one target is set, the other `null` so an edit switches it. */
export function buildBudgetInput(values: BudgetFormValues): BudgetInput {
  const category = values.target === "category";
  return {
    name: values.name.trim(),
    expenseCategoryId: category ? values.target_id : null,
    ledgerAccountId: category ? null : values.target_id,
    campusId: values.campus === "" ? null : values.campus,
    periodStart: values.period_start,
    periodEnd: values.period_end,
    amount: values.amount.trim(),
    notes: values.notes.trim() || null,
  };
}
