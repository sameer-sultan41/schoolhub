import {
  createExpenseCategory,
  deleteExpenseCategory,
  fetchExpenseCategoryOptions,
  listExpenseCategories,
  updateExpenseCategory,
} from "./expense-categories-service";

export const ExpenseCategoriesService = {
  listExpenseCategories,
  fetchExpenseCategoryOptions,
  createExpenseCategory,
  updateExpenseCategory,
  deleteExpenseCategory,
};
export type {
  ExpenseCategoriesQuery,
  ExpenseCategoryInput,
  ExpenseCategoryRecord,
} from "./expense-categories-type";
