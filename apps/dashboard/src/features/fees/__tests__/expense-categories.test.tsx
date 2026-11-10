import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PermissionKey } from "@schoolhub/types";

import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { renderWithProviders } from "@/test-utils";

import { CategoriesTab } from "@/features/fees/expenses/categories-tab";
import {
  accountRecord,
  asUser,
  CATEGORY_ID,
  createExpenseCategory,
  cursorPage,
  deleteExpenseCategory,
  EXPENSE_ACCOUNT_ID,
  fetchLedgerAccountOptions,
  listExpenseCategories,
  ruleViolation,
  stubFeesServices,
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
const CREATE: PermissionKey = "fees.expense.create";
const LEDGER_VIEW: PermissionKey = "fees.ledger.view";

async function renderTab(keys: PermissionKey[]) {
  stubFeesServices("/fees/expenses?tab=categories");
  asUser(...keys);
  listExpenseCategories.mockResolvedValue(
    cursorPage([
      {
        id: CATEGORY_ID,
        name: "Stationery",
        code: "STA",
        ledger_account: EXPENSE_ACCOUNT_ID,
        parent: null,
        is_active: true,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-01T00:00:00Z",
      },
    ]),
  );
  fetchLedgerAccountOptions.mockResolvedValue([
    accountRecord({
      id: EXPENSE_ACCOUNT_ID,
      code: "5100",
      name: "Office supplies",
      account_type: "expense",
    }),
  ]);
  renderWithProviders(
    <>
      <UserLoaded />
      <CategoriesTab />
    </>,
  );
  await screen.findByText(USER_LOADED);
  await screen.findByText("Stationery");
  return userEvent.setup();
}

describe("expense categories tab", () => {
  it("lists each category with its expense account's name", async () => {
    await renderTab([VIEW, LEDGER_VIEW]);

    expect(await screen.findByText("5100 Office supplies")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("asks the ledger only for expense accounts", async () => {
    await renderTab([VIEW, CREATE, LEDGER_VIEW]);

    await waitFor(() => {
      expect(fetchLedgerAccountOptions).toHaveBeenCalledWith(
        expect.objectContaining({ accountType: "expense" }),
      );
    });
  });

  it("offers no write to a viewer holding only the view key", async () => {
    await renderTab([VIEW]);

    expect(screen.queryByRole("button", { name: "New category" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete / })).not.toBeInTheDocument();
  });

  it("offers no New or Edit to a holder of the write key without the ledger read, but still Delete (L59)", async () => {
    await renderTab([VIEW, CREATE]);

    expect(screen.queryByRole("button", { name: "New category" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Stationery" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Stationery" })).toBeInTheDocument();
    expect(fetchLedgerAccountOptions).not.toHaveBeenCalled();
  });

  it("offers New, Edit and Delete to a holder of the write key and the ledger read", async () => {
    await renderTab([VIEW, CREATE, LEDGER_VIEW]);

    expect(screen.getByRole("button", { name: "New category" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Stationery" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Stationery" })).toBeInTheDocument();
  });

  it("creates a category with its mapped input", async () => {
    createExpenseCategory.mockResolvedValue({
      id: "c2",
      name: "Repairs",
      code: "REP",
      ledger_account: EXPENSE_ACCOUNT_ID,
      created_at: "",
      updated_at: "",
    });
    const user = await renderTab([VIEW, CREATE, LEDGER_VIEW]);

    await user.click(screen.getByRole("button", { name: "New category" }));
    const dialog = await screen.findByRole("dialog", { name: "New expense category" });
    await user.type(within(dialog).getByLabelText("Code"), "REP");
    await user.type(within(dialog).getByLabelText("Name"), "Repairs");
    await user.click(await within(dialog).findByRole("combobox", { name: "Expense account" }));
    await user.click(await screen.findByRole("option", { name: "5100 Office supplies" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createExpenseCategory).toHaveBeenCalledWith({
        name: "Repairs",
        code: "REP",
        ledgerAccountId: EXPENSE_ACCOUNT_ID,
        isActive: true,
      });
    });
  });

  it("shows the server's refusal of a non-expense account under the account field", async () => {
    createExpenseCategory.mockRejectedValue(
      ruleViolation("ledger_account", "A category must point at an expense account.", 400),
    );
    const user = await renderTab([VIEW, CREATE, LEDGER_VIEW]);

    await user.click(screen.getByRole("button", { name: "New category" }));
    const dialog = await screen.findByRole("dialog", { name: "New expense category" });
    await user.type(within(dialog).getByLabelText("Code"), "REP");
    await user.type(within(dialog).getByLabelText("Name"), "Repairs");
    await user.click(await within(dialog).findByRole("combobox", { name: "Expense account" }));
    await user.click(await screen.findByRole("option", { name: "5100 Office supplies" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await within(dialog).findByText("A category must point at an expense account."),
    ).toBeInTheDocument();
  });

  it("shows the server's refusal to delete a category in use, inline", async () => {
    deleteExpenseCategory.mockRejectedValue(
      ruleViolation("id", "Stationery has expenses or a budget filed against it."),
    );
    const user = await renderTab([VIEW, CREATE]);

    await user.click(screen.getByRole("button", { name: "Delete Stationery" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(
      await within(dialog).findByText("Stationery has expenses or a budget filed against it."),
    ).toBeInTheDocument();
    expect(deleteExpenseCategory).toHaveBeenCalledWith(CATEGORY_ID);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});
