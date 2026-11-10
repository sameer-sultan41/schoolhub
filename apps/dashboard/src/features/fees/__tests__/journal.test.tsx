import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@schoolhub/api-client";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { renderWithProviders } from "@/test-utils";

import { JournalTab } from "@/features/fees/ledger/journal-tab";
import {
  accountRecord,
  asUser,
  ASSET_ACCOUNT_ID,
  cursorPage,
  entryRecord,
  fetchLedgerAccountOptions,
  INCOME_ACCOUNT_ID,
  listLedgerEntries,
  postJournal,
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

const POST_BUTTON = { name: "Post journal" } as const;
const SUBMIT = { name: "Post entry" } as const;
// The server's own sentence for an unbalanced set (core/money/__init__.py::assert_balanced).
const UNBALANCED =
  "This posting does not balance: debits total 100.00 and credits total 40.00, a difference of 60.00.";

async function renderTab() {
  renderWithProviders(
    <>
      <UserLoaded />
      <JournalTab />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

/** Opens the dialog and fills the date, the memo and both lines' amounts, accounts chosen. */
async function openAndFill(user: Awaited<ReturnType<typeof renderTab>>, memo = "Correct it") {
  await user.click(screen.getByRole("button", POST_BUTTON));
  const dialog = await screen.findByRole("dialog", { name: "Post journal entry" });
  await user.type(within(dialog).getByLabelText("Entry date"), "2026-10-05");
  await user.type(within(dialog).getByLabelText("Memo"), memo);
  const line1 = await within(dialog).findByRole("group", { name: "Line 1" });
  const line2 = within(dialog).getByRole("group", { name: "Line 2" });
  await user.click(within(line1).getByRole("combobox", { name: "Account" }));
  await user.click(await screen.findByRole("option", { name: "1001 Cash" }));
  await user.click(within(line2).getByRole("combobox", { name: "Account" }));
  await user.click(await screen.findByRole("option", { name: "4001 Tuition income" }));
  await user.type(within(line1).getByLabelText("Debit"), "100.00");
  await user.type(within(line2).getByLabelText("Credit"), "40.00");
  return { dialog, line1, line2 };
}

describe("ledger journal tab", () => {
  beforeEach(() => {
    stubFeesServices("/fees/ledger?tab=journal");
    listLedgerEntries.mockResolvedValue(
      cursorPage([
        entryRecord(),
        entryRecord({
          id: "f3333333-3333-4333-8333-333333333333",
          ledger_account: ASSET_ACCOUNT_ID,
          account_code: "1001",
          account_name: "Cash",
          debit: "0.00",
          credit: "50.00",
          memo: "Fee received",
          reference_type: "payment",
          reversed_by_transaction_id: "f4444444-4444-4444-8444-444444444444",
        }),
      ]),
    );
    fetchLedgerAccountOptions.mockResolvedValue([
      accountRecord({ id: ASSET_ACCOUNT_ID, code: "1001", name: "Cash", account_type: "asset" }),
      accountRecord(),
    ]);
  });

  it("lists each line with its account, amounts, source and a Reversed badge", async () => {
    asUser("fees.ledger.view");
    await renderTab();

    await screen.findByText("Correct the October posting");
    const manual = rowOf("Correct the October posting");
    expect(manual.getByText("4001 Tuition income")).toBeInTheDocument();
    expect(manual.getByText("50.00")).toBeInTheDocument();
    expect(manual.getByText("Manual journal")).toBeInTheDocument();
    expect(manual.getByText("Posted")).toBeInTheDocument();
    const payment = rowOf("Fee received");
    expect(payment.getByText("1001 Cash")).toBeInTheDocument();
    expect(payment.getByText("Payment")).toBeInTheDocument();
    expect(payment.getByText("Reversed")).toBeInTheDocument();
  });

  it.each([
    [["fees.ledger.view"] as const, false],
    [["fees.ledger.view", "fees.ledger.create"] as const, true],
  ])("offers Post journal only with the create key (%j)", async (keys, offered) => {
    asUser(...keys);
    await renderTab();

    await screen.findByText("Correct the October posting");
    expect(screen.queryByRole("button", POST_BUTTON) !== null).toBe(offered);
  });

  it("filters by account and by entry date, sending plain days", async () => {
    asUser("fees.ledger.view");
    const user = await renderTab();
    await screen.findByText("Correct the October posting");

    await user.click(screen.getByRole("combobox", { name: "Account" }));
    await user.click(await screen.findByRole("option", { name: "1001 Cash" }));
    await user.type(screen.getByLabelText("From date"), "2026-10-01");
    await user.type(screen.getByLabelText("To date"), "2026-10-31");

    await waitFor(() => {
      expect(listLedgerEntries).toHaveBeenLastCalledWith(
        expect.objectContaining({
          accountId: ASSET_ACCOUNT_ID,
          dateFrom: "2026-10-01",
          dateTo: "2026-10-31",
        }),
      );
    });
    expect(urlParam("account")).toBe(ASSET_ACCOUNT_ID);
  });

  it("filters by source", async () => {
    asUser("fees.ledger.view");
    const user = await renderTab();
    await screen.findByText("Correct the October posting");

    await user.click(screen.getByRole("combobox", { name: "Source" }));
    await user.click(await screen.findByRole("option", { name: "Expense" }));

    await waitFor(() => {
      expect(listLedgerEntries).toHaveBeenLastCalledWith(
        expect.objectContaining({ referenceType: "expense" }),
      );
    });
  });

  describe("post journal dialog", () => {
    beforeEach(() => {
      asUser("fees.ledger.view", "fees.ledger.create");
    });

    it("says so, and holds Post back, when the accounts cannot be loaded", async () => {
      fetchLedgerAccountOptions.mockImplementation((query) =>
        query?.isActive
          ? Promise.reject(new Error("offline"))
          : Promise.resolve([accountRecord({ id: ASSET_ACCOUNT_ID, code: "1001", name: "Cash" })]),
      );
      const user = await renderTab();

      await user.click(screen.getByRole("button", POST_BUTTON));
      const dialog = await screen.findByRole("dialog", { name: "Post journal entry" });

      expect(await within(dialog).findByText(/Accounts could not be loaded/)).toBeInTheDocument();
      expect(within(dialog).getByRole("button", SUBMIT)).toBeDisabled();
    });

    it("shows the running difference as a hint that follows the lines", async () => {
      const user = await renderTab();
      const { dialog, line1, line2 } = await openAndFill(user);

      expect(
        within(dialog).getByText("Debits 100.00, credits 40.00, difference 60.00"),
      ).toBeInTheDocument();
      await user.clear(within(line2).getByLabelText("Credit"));
      await user.type(within(line2).getByLabelText("Credit"), "100.00");
      expect(
        within(dialog).getByText("Debits 100.00, credits 100.00, difference 0.00"),
      ).toBeInTheDocument();
      await user.clear(within(line1).getByLabelText("Debit"));
      await user.type(within(line1).getByLabelText("Debit"), "0.1");
      await user.clear(within(line2).getByLabelText("Credit"));
      await user.type(within(line2).getByLabelText("Credit"), "0.10");
      expect(within(dialog).getByText(/difference 0\.00/)).toBeInTheDocument();
    });

    it("posts an unbalanced entry anyway: the server, not the hint, decides", async () => {
      postJournal.mockRejectedValue(ruleViolation("non_field", UNBALANCED));
      const user = await renderTab();
      const { dialog } = await openAndFill(user);

      expect(within(dialog).getByRole("button", SUBMIT)).toBeEnabled();
      await user.click(within(dialog).getByRole("button", SUBMIT));

      expect(await within(dialog).findByText(UNBALANCED)).toBeInTheDocument();
      expect(postJournal).toHaveBeenCalledWith(
        {
          entryDate: "2026-10-05",
          memo: "Correct it",
          lines: [
            { ledgerAccountId: ASSET_ACCOUNT_ID, debit: "100.00", credit: "0.00" },
            { ledgerAccountId: INCOME_ACCOUNT_ID, debit: "0.00", credit: "40.00" },
          ],
        },
        expect.stringMatching(/\S+/),
      );
      expect(screen.getByRole("dialog", { name: "Post journal entry" })).toBeInTheDocument();
    });

    it("shows a refusal that names a line under that line", async () => {
      postJournal.mockRejectedValue(
        new ApiError({
          status: 400,
          code: "validation_error",
          message: "Each line carries exactly one of debit or credit, and it must be positive.",
          url: "/ledger-entries:post-journal",
          details: [
            {
              field: "lines[1].non_field_errors",
              issue: "Each line carries exactly one of debit or credit, and it must be positive.",
            },
          ],
        }),
      );
      const user = await renderTab();
      const { line1, line2 } = await openAndFill(user);

      await user.click(screen.getByRole("button", SUBMIT));

      expect(
        await within(line2).findByText(/Each line carries exactly one of debit or credit/),
      ).toBeInTheDocument();
      expect(within(line1).queryByText(/Each line carries/)).not.toBeInTheDocument();
    });

    it("requires the memo and an account on every line before it asks the server", async () => {
      const user = await renderTab();
      await user.click(screen.getByRole("button", POST_BUTTON));
      const dialog = await screen.findByRole("dialog", { name: "Post journal entry" });
      await user.click(within(dialog).getByRole("button", SUBMIT));

      expect(
        (await within(dialog).findAllByText("This field is required.")).length,
      ).toBeGreaterThan(2);
      expect(postJournal).not.toHaveBeenCalled();
    });

    it("sends one request for a double click, with one key", async () => {
      let resolve: (lines: ReturnType<typeof entryRecord>[]) => void = () => undefined;
      postJournal.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      const user = await renderTab();
      const { dialog } = await openAndFill(user);

      await user.dblClick(within(dialog).getByRole("button", SUBMIT));

      await waitFor(() => {
        expect(postJournal).toHaveBeenCalledTimes(1);
      });
      resolve([entryRecord()]);
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });

    it("reuses the key on a retry after a failure, and renews it once a field is edited", async () => {
      postJournal.mockRejectedValueOnce(new Error("network down"));
      postJournal.mockRejectedValueOnce(ruleViolation("non_field", UNBALANCED));
      postJournal.mockResolvedValue([entryRecord()]);
      const user = await renderTab();
      const { dialog, line2 } = await openAndFill(user);

      await user.click(within(dialog).getByRole("button", SUBMIT));
      expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", SUBMIT));
      await waitFor(() => {
        expect(postJournal).toHaveBeenCalledTimes(2);
      });
      await within(dialog).findByText(UNBALANCED);

      // Correcting the amount is a different posting: it must not replay the first key.
      await user.clear(within(line2).getByLabelText("Credit"));
      await user.type(within(line2).getByLabelText("Credit"), "100.00");
      await user.click(within(dialog).getByRole("button", SUBMIT));
      await waitFor(() => {
        expect(postJournal).toHaveBeenCalledTimes(3);
      });

      const keys = postJournal.mock.calls.map(([, key]) => key);
      expect(keys[1]).toBe(keys[0]);
      expect(keys[2]).not.toBe(keys[0]);
    });

    it("adds and removes lines, offering Remove only above two", async () => {
      const user = await renderTab();
      await user.click(screen.getByRole("button", POST_BUTTON));
      const dialog = await screen.findByRole("dialog", { name: "Post journal entry" });
      await within(dialog).findByRole("group", { name: "Line 1" });

      expect(
        within(dialog).queryByRole("button", { name: /^Remove line/ }),
      ).not.toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Add line" }));
      expect(within(dialog).getByRole("group", { name: "Line 3" })).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Remove line 3" }));
      expect(within(dialog).queryByRole("group", { name: "Line 3" })).not.toBeInTheDocument();
    });

    it("posts, closes and reloads the journal on success", async () => {
      postJournal.mockResolvedValue([entryRecord()]);
      const user = await renderTab();
      const { dialog, line2 } = await openAndFill(user);
      await user.clear(within(line2).getByLabelText("Credit"));
      await user.type(within(line2).getByLabelText("Credit"), "100.00");
      const readsBefore = listLedgerEntries.mock.calls.length;

      await user.click(within(dialog).getByRole("button", SUBMIT));

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      await waitFor(() => {
        expect(listLedgerEntries.mock.calls.length).toBeGreaterThan(readsBefore);
      });
    });
  });
});
