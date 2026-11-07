import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { renderWithProviders } from "@/test-utils";

import { FeeHeadsTab } from "@/features/fees/heads/fee-heads-tab";
import {
  asUser,
  createFeeHead,
  deleteFeeHead,
  headRecord,
  HEAD_ID,
  INCOME_ACCOUNT_ID,
  listFeeHeads,
  fetchLedgerAccountOptions,
  rowOf,
  ruleViolation,
  stubFeesServices,
  updateFeeHead,
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

async function renderTab() {
  renderWithProviders(
    <>
      <UserLoaded />
      <FeeHeadsTab />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

describe("fee heads tab", () => {
  beforeEach(() => {
    stubFeesServices("/fees/structures?tab=heads");
  });

  it("lists each head with its category, income account and status", async () => {
    asUser("fees.fee-structure.view", "fees.ledger.view");
    await renderTab();

    await screen.findByText("Library fee");
    const row = rowOf("Library fee");
    expect(row.getByText("LIB")).toBeInTheDocument();
    expect(row.getByText("Library")).toBeInTheDocument();
    expect(row.getByText("4001 Tuition income")).toBeInTheDocument();
    expect(row.getByText("Active")).toBeInTheDocument();
  });

  it("offers no write to a viewer holding only the view key, and reads no ledger", async () => {
    asUser("fees.fee-structure.view");
    await renderTab();

    await screen.findByText("Library fee");
    expect(screen.queryByRole("button", { name: "New fee head" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Library fee" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Library fee" })).not.toBeInTheDocument();
    expect(fetchLedgerAccountOptions).not.toHaveBeenCalled();
  });

  it("gates New, Edit and Delete on their own keys", async () => {
    asUser("fees.fee-structure.view", "fees.fee-structure.update", "fees.ledger.view");
    await renderTab();

    await screen.findByText("Library fee");
    expect(screen.getByRole("button", { name: "Edit Library fee" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New fee head" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Library fee" })).not.toBeInTheDocument();
  });

  it("offers no New or Edit to a structure author without the ledger view key", async () => {
    asUser(
      "fees.fee-structure.view",
      "fees.fee-structure.create",
      "fees.fee-structure.update",
      "fees.fee-structure.delete",
    );
    await renderTab();

    await screen.findByText("Library fee");
    expect(screen.queryByRole("button", { name: "New fee head" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Library fee" })).not.toBeInTheDocument();
    // Delete reads no ledger, so it stays.
    expect(screen.getByRole("button", { name: "Delete Library fee" })).toBeInTheDocument();
  });

  it("filters the income-account picker to income accounts and creates the head", async () => {
    asUser("fees.fee-structure.view", "fees.fee-structure.create", "fees.ledger.view");
    createFeeHead.mockResolvedValue(headRecord());
    const user = await renderTab();

    await user.click(screen.getByRole("button", { name: "New fee head" }));
    const dialog = await screen.findByRole("dialog", { name: "New fee head" });
    await user.type(within(dialog).getByLabelText("Code"), "SPORT");
    await user.type(within(dialog).getByLabelText("Name"), "Sports fee");
    await user.click(await within(dialog).findByRole("combobox", { name: "Income account" }));
    await user.click(await screen.findByRole("option", { name: "4001 Tuition income" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(fetchLedgerAccountOptions).toHaveBeenCalledWith({
      accountType: "income",
      isActive: true,
    });
    await waitFor(() => {
      expect(createFeeHead).toHaveBeenCalledWith({
        name: "Sports fee",
        code: "SPORT",
        category: "other",
        ledgerAccountId: INCOME_ACCOUNT_ID,
        isRefundable: false,
        isActive: true,
      });
    });
  });

  it("shows a server error on the account picker it names", async () => {
    asUser("fees.fee-structure.view", "fees.fee-structure.update", "fees.ledger.view");
    updateFeeHead.mockRejectedValue(
      ruleViolation("ledger_account", "A fee head must map to an income account."),
    );
    const user = await renderTab();

    // The ledger read that names the account column lands after the rows: it rebuilds the
    // columns, which remounts the row's buttons, so a click before it would hit a detached one.
    await screen.findByText("4001 Tuition income");
    await user.click(await screen.findByRole("button", { name: "Edit Library fee" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit fee head" });
    await user.click(await within(dialog).findByRole("button", { name: "Save" }));

    expect(
      await within(dialog).findByText("A fee head must map to an income account."),
    ).toBeInTheDocument();
  });

  it("shows the server's in-use refusal on delete, inline, and keeps the dialog open", async () => {
    asUser("fees.fee-structure.view", "fees.fee-structure.delete");
    deleteFeeHead.mockRejectedValue(
      ruleViolation("fee_head", "This fee head is referenced by a fee schedule."),
    );
    const user = await renderTab();

    await user.click(await screen.findByRole("button", { name: "Delete Library fee" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(
      await within(dialog).findByText("This fee head is referenced by a fee schedule."),
    ).toBeInTheDocument();
    expect(deleteFeeHead).toHaveBeenCalledWith(HEAD_ID);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("filters by category through the URL", async () => {
    asUser("fees.fee-structure.view");
    const user = await renderTab();
    await screen.findByText("Library fee");

    await user.click(screen.getByRole("combobox", { name: "Category" }));
    await user.click(await screen.findByRole("option", { name: "Library" }));

    await waitFor(() => {
      expect(listFeeHeads).toHaveBeenLastCalledWith(
        expect.objectContaining({ category: "library" }),
      );
    });
  });
});
