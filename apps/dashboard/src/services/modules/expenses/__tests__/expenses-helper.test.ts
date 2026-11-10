import {
  buildExpenseInput,
  canDecideExpense,
  canEditExpense,
  canMarkExpensePaid,
  canReverseExpense,
  canSubmitExpense,
  defaultExpenseFormValues,
} from "../expenses-helper";
import { EXPENSES_URL_FILTERS } from "../expenses-constant";
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

  it("offers approve and reject on a submitted expense, never to its creator or its submitter", () => {
    const row = (created_by: string | null, submitted_by: string | null) => ({
      status: "submitted" as const,
      created_by,
      submitted_by,
    });
    expect(canDecideExpense(row("u1", "u1"), "u2")).toBe(true);
    expect(canDecideExpense(row("u1", "u1"), "u1")).toBe(false);
    // B edited and submitted A's draft: both are barred, a third person is not.
    expect(canDecideExpense(row("a", "b"), "a")).toBe(false);
    expect(canDecideExpense(row("a", "b"), "b")).toBe(false);
    expect(canDecideExpense(row("a", "b"), "c")).toBe(true);
    expect(canDecideExpense(row(null, null), "c")).toBe(true);
    expect(canDecideExpense({ ...row("u1", "u1"), status: "draft" }, "u2")).toBe(false);
    expect(canDecideExpense(row("u1", "u1"), undefined)).toBe(false);
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

describe("expenses URL filters", () => {
  it("keeps a category or campus only when it is a UUID (or blank)", () => {
    const id = "e2222222-2222-4222-8222-222222222222";
    for (const filter of [EXPENSES_URL_FILTERS.category, EXPENSES_URL_FILTERS.campus]) {
      expect(filter.isValid("")).toBe(true);
      expect(filter.isValid(id)).toBe(true);
      expect(filter.isValid("not-a-uuid")).toBe(false);
    }
  });
});
