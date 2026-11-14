import {
  approveExpense,
  createExpense,
  fetchExpense,
  listExpenses,
  markExpensePaid,
  rejectExpense,
  reverseExpense,
  submitExpense,
  updateExpense,
} from "./expenses-service";

export const ExpensesService = {
  listExpenses,
  fetchExpense,
  createExpense,
  updateExpense,
  submitExpense,
  approveExpense,
  rejectExpense,
  markExpensePaid,
  reverseExpense,
};
export type {
  ExpenseInput,
  ExpensePaymentMethod,
  ExpenseRecord,
  ExpensesQuery,
  ExpenseStatus,
} from "./expenses-type";
