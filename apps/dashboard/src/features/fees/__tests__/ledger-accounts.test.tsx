import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { renderWithProviders } from "@/test-utils";

import { AccountsTab } from "@/features/fees/ledger/accounts-tab";
import {
  accountRecord,
  asUser,
  createLedgerAccount,
  cursorPage,
  deleteLedgerAccount,
  fetchLedgerAccountOptions,
  INCOME_ACCOUNT_ID,
  listLedgerAccounts,
  rowOf,
  ruleViolation,
  stubFeesServices,
  urlParam,
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

const SYSTEM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** A custom income account with a parent, and a system asset account. */
function twoAccounts() {
  return cursorPage([
    accountRecord({ parent: SYSTEM_ID }),
    accountRecord({
      id: SYSTEM_ID,
      code: "1001",
      name: "Cash",
      account_type: "asset",
      is_system: true,
    }),
  ]);
}

async function renderTab() {
  renderWithProviders(
    <>
      <UserLoaded />
      <AccountsTab />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

describe("ledger accounts tab", () => {
  beforeEach(() => {
    stubFeesServices("/fees/ledger");
    listLedgerAccounts.mockResolvedValue(twoAccounts());
    fetchLedgerAccountOptions.mockResolvedValue(twoAccounts().items);
  });

  it("lists each account with its type, parent, status and a system badge", async () => {
    asUser("fees.ledger.view");
    await renderTab();

    await screen.findByText("Tuition income");
    const income = rowOf("Tuition income");
    expect(income.getByText("Income")).toBeInTheDocument();
    expect(income.getByText("1001 Cash")).toBeInTheDocument();
    expect(income.getByText("Active")).toBeInTheDocument();
    const cash = rowOf("Cash");
    expect(cash.getByText("Asset")).toBeInTheDocument();
    expect(cash.getByText("System account")).toBeInTheDocument();
  });

  it("offers no write to a viewer holding only the view key", async () => {
    asUser("fees.ledger.view");
    await renderTab();

    await screen.findByText("Tuition income");
    expect(screen.queryByRole("button", { name: "New account" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete / })).not.toBeInTheDocument();
  });

  it("offers Edit on every account but Delete only on a custom one", async () => {
    asUser("fees.ledger.view", "fees.ledger.create");
    await renderTab();

    await screen.findByText("Tuition income");
    expect(screen.getByRole("button", { name: "New account" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Tuition income" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Tuition income" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Cash" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Cash" })).not.toBeInTheDocument();
  });

  it("filters by type through the URL", async () => {
    asUser("fees.ledger.view");
    const user = await renderTab();
    await screen.findByText("Tuition income");

    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: "Income" }));

    await waitFor(() => {
      expect(urlParam("type")).toBe("income");
    });
    expect(listLedgerAccounts).toHaveBeenLastCalledWith(
      expect.objectContaining({ accountType: "income" }),
    );
  });

  it("creates an account with its mapped input", async () => {
    asUser("fees.ledger.view", "fees.ledger.create");
    createLedgerAccount.mockResolvedValue(accountRecord());
    const user = await renderTab();

    await user.click(screen.getByRole("button", { name: "New account" }));
    const dialog = await screen.findByRole("dialog", { name: "New ledger account" });
    await user.type(within(dialog).getByLabelText("Code"), "4100");
    await user.type(within(dialog).getByLabelText("Name"), "Transport income");
    await user.click(within(dialog).getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: "Income" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createLedgerAccount).toHaveBeenCalledWith({
        code: "4100",
        name: "Transport income",
        accountType: "income",
        parentId: null,
        isActive: true,
      });
    });
  });

  it("offers only parents of the chosen type, and clears a parent the new type no longer fits", async () => {
    asUser("fees.ledger.view", "fees.ledger.create");
    createLedgerAccount.mockResolvedValue(accountRecord());
    const user = await renderTab();

    await user.click(screen.getByRole("button", { name: "New account" }));
    const dialog = await screen.findByRole("dialog", { name: "New ledger account" });
    await user.type(within(dialog).getByLabelText("Code"), "4200");
    await user.type(within(dialog).getByLabelText("Name"), "Fees income");

    // The default type is Asset: only the asset account is a possible parent.
    await user.click(await within(dialog).findByRole("combobox", { name: "Parent account" }));
    expect(screen.queryByRole("option", { name: "4001 Tuition income" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("option", { name: "1001 Cash" }));

    await user.click(within(dialog).getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: "Income" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createLedgerAccount).toHaveBeenCalledWith(
        expect.objectContaining({ accountType: "income", parentId: null }),
      );
    });
  });

  it("shows a server error on the field it names", async () => {
    asUser("fees.ledger.view", "fees.ledger.create");
    createLedgerAccount.mockRejectedValue(
      ruleViolation("code", "This code is already in use.", 400),
    );
    const user = await renderTab();

    await user.click(screen.getByRole("button", { name: "New account" }));
    const dialog = await screen.findByRole("dialog", { name: "New ledger account" });
    await user.type(within(dialog).getByLabelText("Code"), "4001");
    await user.type(within(dialog).getByLabelText("Name"), "Duplicate");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("This code is already in use.")).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
  });

  it("shows the server's refusal to delete an account with postings, inline", async () => {
    asUser("fees.ledger.view", "fees.ledger.create");
    deleteLedgerAccount.mockRejectedValue(
      ruleViolation("id", "4001 Tuition income has ledger postings and cannot be deleted."),
    );
    const user = await renderTab();

    await user.click(await screen.findByRole("button", { name: "Delete Tuition income" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(
      await within(dialog).findByText(
        "4001 Tuition income has ledger postings and cannot be deleted.",
      ),
    ).toBeInTheDocument();
    expect(deleteLedgerAccount).toHaveBeenCalledWith(INCOME_ACCOUNT_ID);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});
