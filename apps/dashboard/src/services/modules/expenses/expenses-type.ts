import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shape (ADR-0017). `created_by` is read-only: it hides Approve from the submitter. */
export type ExpenseRecord = ApiSchemas["Expense"];
export type ExpenseStatus = ApiSchemas["ExpenseStatusEnum"];
export type ExpensePaymentMethod = Exclude<
  NonNullable<ExpenseRecord["payment_method"]>,
  "online_gateway"
>;

export interface ExpensesQuery {
  expenseCategoryId?: string;
  campusId?: string;
  status?: ExpenseStatus;
  /** ISO dates bounding `expense_date`. */
  dateFrom?: string;
  dateTo?: string;
  /** The approver's queue: only submitted expenses. */
  awaitingApproval?: boolean;
  search?: string;
  ordering?: string;
  cursor?: string;
  pageSize?: number;
}

/** A create sends every required field; an update (draft only) sends only the fields given. */
export interface ExpenseInput {
  expenseCategoryId: string;
  campusId?: string | null;
  vendorName?: string | null;
  description: string;
  amount: string;
  taxAmount?: string;
  expenseDate: string;
  paymentMethod?: ExpensePaymentMethod | null;
}
