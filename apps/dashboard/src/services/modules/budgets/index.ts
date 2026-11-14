import { approveBudget, createBudget, listBudgets, updateBudget } from "./budgets-service";

export const BudgetsService = { listBudgets, createBudget, updateBudget, approveBudget };
export type { BudgetInput, BudgetRecord, BudgetsQuery, BudgetStatus } from "./budgets-type";
