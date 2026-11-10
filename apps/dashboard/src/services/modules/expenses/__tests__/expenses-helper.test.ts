import {
  buildExpenseInput,
  canDecideExpense,
  canEditExpense,
  canMarkExpensePaid,
  canReverseExpense,
  canSubmitExpense,
  defaultExpenseFormValues,
} from "../expenses-helper";
import type { ExpenseStatus } from "../expenses-type";

const STATUSES: ExpenseStatus[] = [
  "draft",
  "submitted",
  "approved",
  "paid",
  "rejected",
  "reversed",
];
const at = (status: ExpenseStatus) => ({ status });
const matching = (pred: (s: { status: ExpenseStatus }) => boolean) =>
  STATUSES.filter((s) => pred(at(s)));

describe("expense status gates", () => {
  it("edits and submits only a draft", () => {
    expect(matching(canEditExpense)).toEqual(["draft"]);
    expect(matching(canSubmitExpense)).toEqual(["draft"]);
  });

  it("marks paid only an approved expense", () => {
    expect(matching(canMarkExpensePaid)).toEqual(["approved"]);
  });

  it("reverses only an approved or paid expense", () => {
    expect(matching(canReverseExpense)).toEqual(["approved", "paid"]);
  });

  it("offers approve and reject on a submitted expense, never to its creator", () => {
    expect(canDecideExpense({ status: "submitted", created_by: "u1" }, "u2")).toBe(true);
    expect(canDecideExpense({ status: "submitted", created_by: "u1" }, "u1")).toBe(false);
    expect(canDecideExpense({ status: "draft", created_by: "u1" }, "u2")).toBe(false);
    expect(canDecideExpense({ status: "submitted", created_by: "u1" }, undefined)).toBe(false);
  });
});

describe("buildExpenseInput", () => {
  it("trims, and sends an emptied optional field as null so an edit clears it", () => {
    const input = buildExpenseInput({
      ...defaultExpenseFormValues(),
      expense_category: "c1",
      description: " Chalk ",
      amount: "10.00",
      expense_date: "2026-02-01",
    });
    expect(input).toMatchObject({
      expenseCategoryId: "c1",
      description: "Chalk",
      campusId: null,
      vendorName: null,
      paymentMethod: null,
    });
  });
});
