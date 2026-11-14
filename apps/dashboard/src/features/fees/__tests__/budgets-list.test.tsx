import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PermissionKey } from "@schoolhub/types";

import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { renderWithProviders } from "@/test-utils";

import { BudgetsTab } from "@/features/fees/expenses/budgets-tab";
import {
  approveBudget,
  asUser,
  BUDGET_ID,
  budgetRecord,
  CATEGORY_ID,
  createBudget,
  cursorPage,
  listBudgets,
  ruleViolation,
  stubFeesServices,
  updateBudget,
} from "./fees-test-support";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ feesServicesMock: () => unknown }>("./fees-services-mock")
    .feesServicesMock(),
);

const VIEW: PermissionKey = "fees.expense.view";
const CREATE: PermissionKey = "fees.budget.create";
const APPROVE: PermissionKey = "fees.budget.approve";

// The server's sentences, verbatim (`services.approve_budget`, `BudgetSerializer.validate`).
const ALREADY = "This budget is already approved.";
const ONE_TARGET =
  "Name exactly one of `ledger_account` or `expense_category` — a budget against both is counted twice by the variance report.";
const EDIT = "Edit Q4 stationery";
const APPROVE_ROW = "Approve Q4 stationery";

async function renderTab(
  keys: PermissionKey[],
  budgets: ReturnType<typeof budgetRecord>[] = [budgetRecord()],
) {
  stubFeesServices("/fees/expenses?tab=budgets");
  asUser(...keys);
  listBudgets.mockResolvedValue(cursorPage(budgets));
  renderWithProviders(
    <>
      <UserLoaded />
      <BudgetsTab />
    </>,
  );
  await screen.findByText(USER_LOADED);
  await screen.findByText("Q4 stationery");
  return userEvent.setup();
}

describe("budgets tab", () => {
  it("lists a budget with its category, period, amount and status", async () => {
    await renderTab([VIEW]);

    expect(await screen.findByText("Stationery")).toBeInTheDocument();
    expect(screen.getByText("5,000.00")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("offers nothing to a viewer holding only the view key", async () => {
    await renderTab([VIEW]);

    expect(screen.queryByRole("button", { name: "New budget" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: EDIT })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: APPROVE_ROW })).not.toBeInTheDocument();
  });

  it("offers Edit but not Approve with only fees.budget.create", async () => {
    await renderTab([VIEW, CREATE]);

    expect(screen.getByRole("button", { name: "New budget" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: EDIT })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: APPROVE_ROW })).not.toBeInTheDocument();
  });

  it("offers Approve only with fees.budget.approve (the owner's key)", async () => {
    await renderTab([VIEW, APPROVE]);

    expect(screen.getByRole("button", { name: APPROVE_ROW })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: EDIT })).not.toBeInTheDocument();
  });

  it.each(["approved", "closed"] as const)(
    "offers neither Edit nor Approve on a %s budget, to a holder of both keys",
    async (status) => {
      await renderTab([VIEW, CREATE, APPROVE], [budgetRecord({ status })]);

      expect(screen.queryByRole("button", { name: EDIT })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: APPROVE_ROW })).not.toBeInTheDocument();
    },
  );

  it("approves a draft and calls the colon-action", async () => {
    approveBudget.mockResolvedValue(budgetRecord({ status: "approved" }));
    const user = await renderTab([VIEW, APPROVE]);
    const reads = listBudgets.mock.calls.length;

    await user.click(screen.getByRole("button", { name: APPROVE_ROW }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(approveBudget).toHaveBeenCalledWith(BUDGET_ID);
    });
    await waitFor(() => {
      expect(listBudgets.mock.calls.length).toBeGreaterThan(reads);
    });
  });

  it("shows the server's refusal to approve inline", async () => {
    approveBudget.mockRejectedValue(ruleViolation("status", ALREADY));
    const user = await renderTab([VIEW, APPROVE]);

    await user.click(screen.getByRole("button", { name: APPROVE_ROW }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));

    expect(await within(dialog).findByText(ALREADY)).toBeInTheDocument();
  });

  it("creates a draft budget against a category", async () => {
    createBudget.mockResolvedValue(budgetRecord());
    const user = await renderTab([VIEW, CREATE]);

    await user.click(screen.getByRole("button", { name: "New budget" }));
    const dialog = await screen.findByRole("dialog", { name: "New budget" });
    await user.type(within(dialog).getByLabelText("Name"), "Q1 repairs");
    await user.click(await within(dialog).findByRole("combobox", { name: "Expense category" }));
    await user.click(await screen.findByRole("option", { name: "STA Stationery" }));
    await user.type(within(dialog).getByLabelText("Period starts"), "2027-01-01");
    await user.type(within(dialog).getByLabelText("Period ends"), "2027-03-31");
    await user.type(within(dialog).getByLabelText("Amount"), "900");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createBudget).toHaveBeenCalledWith({
        name: "Q1 repairs",
        expenseCategoryId: CATEGORY_ID,
        ledgerAccountId: null,
        campusId: null,
        periodStart: "2027-01-01",
        periodEnd: "2027-03-31",
        amount: "900",
        notes: null,
      });
    });
  });

  it("shows the server's 'exactly one target' refusal as the form's message", async () => {
    updateBudget.mockRejectedValue(ruleViolation("non_field_errors", ONE_TARGET, 400));
    const user = await renderTab([VIEW, CREATE]);

    await user.click(screen.getByRole("button", { name: EDIT }));
    const dialog = await screen.findByRole("dialog", { name: "Edit budget" });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText(ONE_TARGET)).toBeInTheDocument();
  });

  it("shows a 400 under expense_category beneath the target picker, the input it stands for", async () => {
    updateBudget.mockRejectedValue(
      ruleViolation("expense_category", "STA Stationery is inactive.", 400),
    );
    const user = await renderTab([VIEW, CREATE]);

    await user.click(screen.getByRole("button", { name: EDIT }));
    const dialog = await screen.findByRole("dialog", { name: "Edit budget" });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    const message = await within(dialog).findByText("STA Stationery is inactive.");
    expect(message.id).toMatch(/form-item-message$/);
  });
});
