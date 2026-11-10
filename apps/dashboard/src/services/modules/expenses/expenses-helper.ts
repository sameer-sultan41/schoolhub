import type { QueryParams } from "@schoolhub/api-client";
import { FILTER_ALL } from "@/lib/constants";
import { copyMappedFields } from "@/lib/helpers";
import {
  AWAITING_APPROVAL_ON,
  EXPENSE_PAYMENT_METHODS,
  EXPENSE_STATUS_DECIDABLE,
  EXPENSE_STATUS_EDITABLE,
  EXPENSE_STATUS_PAYABLE,
  EXPENSE_STATUS_SUBMITTABLE,
  EXPENSE_STATUSES,
  EXPENSE_STATUSES_REVERSIBLE,
  EXPENSES_BODY_FIELDS,
  EXPENSES_QUERY_FIELDS,
} from "./expenses-constant";
import type { ExpenseFormValues } from "./expenses.schema";
import type { ExpenseInput, ExpenseRecord, ExpensesQuery, ExpenseStatus } from "./expenses-type";

/** The expenses module's pure helpers: plain data in, plain data out. */

/** The list's query string: only the filters given are sent (`awaiting_approval=false` is never sent). */
export function toExpensesQueryParams(query: ExpensesQuery): QueryParams {
  const params: Record<string, unknown> = {};
  copyMappedFields(
    query,
    EXPENSES_QUERY_FIELDS,
    (value) => value !== undefined && value !== "" && value !== false,
    params,
  );
  return params as QueryParams;
}

/** A create or update body: only the fields given, in the API's snake_case. */
export function toExpenseBody(input: Partial<ExpenseInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, EXPENSES_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}

/** `:reverse`'s body: the reason is required. */
export function toReverseExpenseBody(reason: string): Record<string, unknown> {
  return { reason };
}

export function expenseStatusFilter(value: string): ExpenseStatus | undefined {
  return value === FILTER_ALL ? undefined : EXPENSE_STATUSES.find((status) => status === value);
}

/** The "Awaiting approval" URL value -> the API's flag (`undefined` when off). */
export function awaitingApprovalFlag(value: string): boolean | undefined {
  return value === AWAITING_APPROVAL_ON ? true : undefined;
}

/** Only a draft can be edited (the server refuses a figure change on any other status). */
export function canEditExpense(expense: Pick<ExpenseRecord, "status">): boolean {
  return expense.status === EXPENSE_STATUS_EDITABLE;
}

export function canSubmitExpense(expense: Pick<ExpenseRecord, "status">): boolean {
  return expense.status === EXPENSE_STATUS_SUBMITTABLE;
}

/**
 * Whether Approve and Reject are offered to this viewer: only on a submitted expense, and never to
 * the person who created it (the server refuses that with a 422, segregation of duties; a button
 * that always fails for that person is not offered). A row with no recorded creator is offered.
 */
export function canDecideExpense(
  expense: Pick<ExpenseRecord, "status" | "created_by">,
  currentUserId: string | undefined,
): boolean {
  return (
    expense.status === EXPENSE_STATUS_DECIDABLE &&
    currentUserId !== undefined &&
    expense.created_by !== currentUserId
  );
}

/** Mark paid is offered only on an approved expense. */
export function canMarkExpensePaid(expense: Pick<ExpenseRecord, "status">): boolean {
  return expense.status === EXPENSE_STATUS_PAYABLE;
}

/** Reverse is offered only on an approved or paid expense. */
export function canReverseExpense(expense: Pick<ExpenseRecord, "status">): boolean {
  return EXPENSE_STATUSES_REVERSIBLE.includes(expense.status);
}

export function defaultExpenseFormValues(): ExpenseFormValues {
  return {
    expense_category: "",
    campus: "",
    vendor_name: "",
    description: "",
    amount: "",
    tax_amount: "",
    expense_date: "",
    payment_method: "",
  };
}

export function recordToExpenseFormValues(record: ExpenseRecord): ExpenseFormValues {
  return {
    expense_category: record.expense_category,
    campus: record.campus ?? "",
    vendor_name: record.vendor_name ?? "",
    description: record.description,
    amount: record.amount,
    tax_amount: record.tax_amount ?? "",
    expense_date: record.expense_date,
    payment_method: EXPENSE_PAYMENT_METHODS.find((m) => m === record.payment_method) ?? "",
  };
}

/** Form values -> the service input; an emptied optional field is sent as `null` so an edit clears it. */
export function buildExpenseInput(values: ExpenseFormValues): ExpenseInput {
  return {
    expenseCategoryId: values.expense_category,
    campusId: values.campus === "" ? null : values.campus,
    vendorName: values.vendor_name.trim() || null,
    description: values.description.trim(),
    amount: values.amount.trim(),
    taxAmount: values.tax_amount.trim() || undefined,
    expenseDate: values.expense_date,
    paymentMethod: values.payment_method === "" ? null : values.payment_method,
  };
}
