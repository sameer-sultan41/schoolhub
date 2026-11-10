import {
  buildBudgetInput,
  canApproveBudget,
  canEditBudget,
  defaultBudgetFormValues,
} from "../budgets-helper";

describe("budget gates", () => {
  it("approves and edits only a draft", () => {
    expect(canApproveBudget({ status: "draft" })).toBe(true);
    expect(canApproveBudget({ status: "approved" })).toBe(false);
    expect(canApproveBudget({ status: "closed" })).toBe(false);
    expect(canEditBudget({ status: "draft" })).toBe(true);
    expect(canEditBudget({ status: "approved" })).toBe(false);
  });
});

describe("buildBudgetInput", () => {
  it("sets exactly one target and nulls the other", () => {
    const base = { ...defaultBudgetFormValues(), name: "Q1", target_id: "t1", amount: "5" };
    expect(buildBudgetInput({ ...base, target: "category" })).toMatchObject({
      expenseCategoryId: "t1",
      ledgerAccountId: null,
    });
    expect(buildBudgetInput({ ...base, target: "account" })).toMatchObject({
      expenseCategoryId: null,
      ledgerAccountId: "t1",
    });
  });
});
