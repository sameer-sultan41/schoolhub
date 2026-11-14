import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithClient } from "@/test-utils";

import { ExpenseActionDialog } from "@/features/fees/expenses/expense-action-dialog";
import { ReverseExpenseDialog } from "@/features/fees/expenses/reverse-expense-dialog";
import { queryKeys } from "@/lib/query-client";
import {
  approveExpense,
  expenseRecord,
  rejectExpense,
  reverseExpense,
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

const LEDGER_KEY = queryKeys.module("ledger-entries");
const BUDGETS_KEY = queryKeys.module("budgets");
const EXPENSES_KEY = queryKeys.module("expenses");

function invalidatedKeys(spy: jest.SpyInstance) {
  return spy.mock.calls.map(([filters]) => (filters as { queryKey: unknown }).queryKey);
}

beforeEach(() => {
  stubFeesServices("/fees/expenses");
});

describe("what an expense posting refreshes", () => {
  it("Approve refreshes the expenses, the journal and the budgets", async () => {
    approveExpense.mockResolvedValue(expenseRecord({ status: "approved" }));
    const { queryClient } = renderWithClient(
      <ExpenseActionDialog
        open
        onOpenChange={jest.fn()}
        expense={expenseRecord()}
        action="approve"
      />,
    );
    const spy = jest.spyOn(queryClient, "invalidateQueries");

    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Approve" }),
    );

    await waitFor(() => {
      expect(invalidatedKeys(spy)).toEqual(
        expect.arrayContaining([EXPENSES_KEY, LEDGER_KEY, BUDGETS_KEY]),
      );
    });
  });

  it("Reject posts nothing, so it leaves the journal and the budgets alone", async () => {
    rejectExpense.mockResolvedValue(expenseRecord({ status: "rejected" }));
    const { queryClient } = renderWithClient(
      <ExpenseActionDialog
        open
        onOpenChange={jest.fn()}
        expense={expenseRecord()}
        action="reject"
      />,
    );
    const spy = jest.spyOn(queryClient, "invalidateQueries");

    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Reject" }),
    );

    await waitFor(() => {
      expect(invalidatedKeys(spy)).toEqual([EXPENSES_KEY]);
    });
  });

  it("Reverse refreshes the expenses, the journal and the budgets", async () => {
    reverseExpense.mockResolvedValue(expenseRecord({ status: "reversed" }));
    const { queryClient } = renderWithClient(
      <ReverseExpenseDialog
        open
        onOpenChange={jest.fn()}
        expense={expenseRecord({ status: "approved" })}
      />,
    );
    const spy = jest.spyOn(queryClient, "invalidateQueries");

    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Reason"), "Paid twice");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reverse" }));

    await waitFor(() => {
      expect(invalidatedKeys(spy)).toEqual(
        expect.arrayContaining([EXPENSES_KEY, LEDGER_KEY, BUDGETS_KEY]),
      );
    });
  });
});
