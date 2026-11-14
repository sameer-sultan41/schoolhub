import type { BudgetStatus, ExpensePaymentMethod, ExpenseStatus } from "@/services";

/**
 * Each expense and budget status's message key in the `fees` namespace, and its badge variant.
 * Exhaustive records (L32): a value the generated enum gains fails to compile here until labelled.
 */

export const EXPENSE_STATUS_LABEL_KEY: Record<ExpenseStatus, string> = {
  draft: "expenses.expenses.status.draft",
  submitted: "expenses.expenses.status.submitted",
  approved: "expenses.expenses.status.approved",
  paid: "expenses.expenses.status.paid",
  rejected: "expenses.expenses.status.rejected",
  reversed: "expenses.expenses.status.reversed",
};

export const EXPENSE_STATUS_BADGE: Record<
  ExpenseStatus,
  "primary" | "success" | "warning" | "destructive" | "secondary"
> = {
  draft: "secondary",
  submitted: "warning",
  approved: "primary",
  paid: "success",
  rejected: "destructive",
  reversed: "destructive",
};

export const EXPENSE_METHOD_LABEL_KEY: Record<ExpensePaymentMethod, string> = {
  cash: "expenses.expenses.method.cash",
  cheque: "expenses.expenses.method.cheque",
  bank_transfer: "expenses.expenses.method.bank_transfer",
  card: "expenses.expenses.method.card",
};

export const BUDGET_STATUS_LABEL_KEY: Record<BudgetStatus, string> = {
  draft: "expenses.budgets.status.draft",
  approved: "expenses.budgets.status.approved",
  closed: "expenses.budgets.status.closed",
};

export const BUDGET_STATUS_BADGE: Record<
  BudgetStatus,
  "primary" | "success" | "warning" | "destructive" | "secondary"
> = {
  draft: "warning",
  approved: "success",
  closed: "secondary",
};
