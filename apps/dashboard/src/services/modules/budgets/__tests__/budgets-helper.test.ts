import { ApiError } from "@schoolhub/api-client";
import {
  budgetErrorFields,
  buildBudgetInput,
  canApproveBudget,
  canEditBudget,
  defaultBudgetFormValues,
  mapBudgetTargetErrors,
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

describe("budget error mapping", () => {
  const refused = (field: string) =>
    new ApiError({
      status: 400,
      code: "validation_error",
      message: "x",
      url: "/budgets",
      details: [{ field, issue: "issue" }],
    });

  it("re-keys the target's API fields as the form's target_id", () => {
    for (const field of ["ledger_account", "expense_category"]) {
      const mapped = mapBudgetTargetErrors(refused(field)) as ApiError;
      expect(mapped.fieldErrors()).toEqual({ target_id: "issue" });
    }
  });

  it("leaves another field, or a non-API error, untouched", () => {
    const other = refused("amount");
    expect(mapBudgetTargetErrors(other)).toBe(other);
    const plain = new Error("boom");
    expect(mapBudgetTargetErrors(plain)).toBe(plain);
  });

  it("knows the campus input only when the picker is rendered", () => {
    expect(budgetErrorFields(true)).toContain("campus");
    expect(budgetErrorFields(false)).not.toContain("campus");
    expect(budgetErrorFields(false)).toContain("target_id");
    expect(budgetErrorFields(true)).not.toContain("ledger_account");
  });
});
