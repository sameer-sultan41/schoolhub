import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PermissionKey } from "@schoolhub/types";

import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { renderWithProviders } from "@/test-utils";

import { ExpensesTab } from "@/features/fees/expenses/expenses-tab";
import {
  approveExpense,
  asUser,
  CATEGORY_ID,
  createExpense,
  CURRENT_USER_ID,
  cursorPage,
  EXPENSE_ID,
  expenseRecord,
  listExpenses,
  markExpensePaid,
  rejectExpense,
  reverseExpense,
  ruleViolation,
  stubFeesServices,
  submitExpense,
  updateExpense,
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

type Status = ReturnType<typeof expenseRecord>["status"];

const NO = "EXP-2026-0001";
// The server's sentences, verbatim (`services.decide_expense`, `ExpenseSerializer.validate`).
const SELF_APPROVAL =
  "The person who submitted an expense cannot approve it (§15, and auth-and-rbac §2.4).";
const FIGURES_FIXED =
  "This expense is submitted and its figures are fixed. Reject it and record a new one.";
const VIEW: PermissionKey = "fees.expense.view";
const CREATE: PermissionKey = "fees.expense.create";
const UPDATE: PermissionKey = "fees.expense.update";
const APPROVE: PermissionKey = "fees.expense.approve";

/** Each row action's accessible name: the table offers one per status and key. */
const ACTIONS = {
  edit: `Edit expense ${NO}`,
  submit: `Submit expense ${NO}`,
  approve: `Approve expense ${NO}`,
  reject: `Reject expense ${NO}`,
  markPaid: `Mark expense ${NO} paid`,
  reverse: `Reverse expense ${NO}`,
} as const;
type Action = keyof typeof ACTIONS;

async function renderTab(
  keys: PermissionKey[],
  expenses: ReturnType<typeof expenseRecord>[] = [expenseRecord()],
) {
  stubFeesServices("/fees/expenses");
  asUser(...keys);
  listExpenses.mockResolvedValue(cursorPage(expenses));
  renderWithProviders(
    <>
      <UserLoaded />
      <ExpensesTab />
    </>,
  );
  await screen.findByText(USER_LOADED);
  await screen.findByText("Printer paper");
  return userEvent.setup();
}

function shownActions(): Action[] {
  return (Object.keys(ACTIONS) as Action[]).filter(
    (action) => screen.queryByRole("button", { name: ACTIONS[action] }) !== null,
  );
}

describe("expenses tab: row actions", () => {
  it.each<[Status, Action[]]>([
    ["draft", ["edit", "submit"]],
    ["submitted", ["approve", "reject"]],
    ["approved", ["markPaid", "reverse"]],
    ["paid", ["reverse"]],
    ["rejected", []],
    ["reversed", []],
  ])("offers a %s expense, to a holder of every key, exactly %j", async (status, expected) => {
    await renderTab([VIEW, CREATE, UPDATE, APPROVE], [expenseRecord({ status })]);

    expect(shownActions()).toEqual(expected);
  });

  it.each<[string, PermissionKey[], Status, Action[]]>([
    ["only the view key", [VIEW], "draft", []],
    ["only the view key", [VIEW], "submitted", []],
    ["only the view key", [VIEW], "approved", []],
    ["create alone", [VIEW, CREATE], "draft", ["submit"]],
    ["update alone", [VIEW, UPDATE], "draft", ["edit"]],
    ["update alone", [VIEW, UPDATE], "approved", ["markPaid"]],
    ["update alone", [VIEW, UPDATE], "submitted", []],
    ["approve alone", [VIEW, APPROVE], "submitted", ["approve", "reject"]],
    ["approve alone", [VIEW, APPROVE], "approved", ["reverse"]],
    ["approve alone", [VIEW, APPROVE], "paid", ["reverse"]],
    ["approve alone", [VIEW, APPROVE], "draft", []],
  ])("with %s a %s-expense row shows %j", async (_label, keys, status, expected) => {
    await renderTab(keys, [expenseRecord({ status })]);

    expect(shownActions()).toEqual(expected);
  });

  it("hides Approve and Reject on a submitted expense the viewer created", async () => {
    await renderTab(
      [VIEW, CREATE, UPDATE, APPROVE],
      [expenseRecord({ status: "submitted", created_by: CURRENT_USER_ID })],
    );
    expect(shownActions()).toEqual([]);
  });

  it("still offers Reverse on an approved expense the viewer created", async () => {
    await renderTab(
      [VIEW, APPROVE],
      [expenseRecord({ status: "approved", created_by: CURRENT_USER_ID })],
    );
    expect(shownActions()).toEqual(["reverse"]);
  });

  it("shows the total (net plus tax) as a formatted amount", async () => {
    await renderTab([VIEW]);

    expect(screen.getByText("115.00")).toBeInTheDocument();
    expect(screen.getByText("Stationery")).toBeInTheDocument();
    expect(screen.getByText("Submitted")).toBeInTheDocument();
  });
});

describe("expenses tab: filters", () => {
  it("narrows to the approver's queue with Awaiting approval, through the URL", async () => {
    const user = await renderTab([VIEW, APPROVE]);

    await user.click(screen.getByRole("button", { name: "Awaiting approval" }));

    await waitFor(() => {
      expect(urlParam("awaiting")).toBe("true");
    });
    expect(listExpenses).toHaveBeenLastCalledWith(
      expect.objectContaining({ awaitingApproval: true }),
    );
    expect(screen.getByRole("button", { name: "Awaiting approval" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("filters by status through the URL", async () => {
    const user = await renderTab([VIEW]);

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Paid" }));

    await waitFor(() => {
      expect(urlParam("status")).toBe("paid");
    });
    expect(listExpenses).toHaveBeenLastCalledWith(expect.objectContaining({ status: "paid" }));
  });
});

describe("expenses tab: transitions", () => {
  it("submits a draft and reloads the list", async () => {
    submitExpense.mockResolvedValue(expenseRecord({ status: "submitted" }));
    const user = await renderTab([VIEW, CREATE], [expenseRecord({ status: "draft" })]);
    const reads = listExpenses.mock.calls.length;

    await user.click(screen.getByRole("button", { name: ACTIONS.submit }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(submitExpense).toHaveBeenCalledWith(EXPENSE_ID);
    });
    await waitFor(() => {
      expect(listExpenses.mock.calls.length).toBeGreaterThan(reads);
    });
  });

  it("approves, rejects and marks paid through their own calls", async () => {
    approveExpense.mockResolvedValue(expenseRecord({ status: "approved" }));
    rejectExpense.mockResolvedValue(expenseRecord({ status: "rejected" }));
    markExpensePaid.mockResolvedValue(expenseRecord({ status: "paid" }));

    const user = await renderTab([VIEW, UPDATE, APPROVE], [expenseRecord()]);
    await user.click(screen.getByRole("button", { name: ACTIONS.approve }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Approve" }),
    );
    await waitFor(() => {
      expect(approveExpense).toHaveBeenCalledWith(EXPENSE_ID);
    });
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: ACTIONS.reject }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Reject" }),
    );
    await waitFor(() => {
      expect(rejectExpense).toHaveBeenCalledWith(EXPENSE_ID);
    });
  });

  it("marks an approved expense paid", async () => {
    markExpensePaid.mockResolvedValue(expenseRecord({ status: "paid" }));
    const user = await renderTab([VIEW, UPDATE], [expenseRecord({ status: "approved" })]);

    await user.click(screen.getByRole("button", { name: ACTIONS.markPaid }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Mark paid" }),
    );

    await waitFor(() => {
      expect(markExpensePaid).toHaveBeenCalledWith(EXPENSE_ID);
    });
  });

  it("shows the server's self-approval refusal inline and keeps the dialog open", async () => {
    approveExpense.mockRejectedValue(ruleViolation("approved_by", SELF_APPROVAL));
    const user = await renderTab([VIEW, APPROVE]);

    await user.click(screen.getByRole("button", { name: ACTIONS.approve }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));

    expect(await within(dialog).findByText(SELF_APPROVAL)).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("asks for a reason to reverse, and sends it", async () => {
    reverseExpense.mockResolvedValue(expenseRecord({ status: "reversed" }));
    const user = await renderTab([VIEW, APPROVE], [expenseRecord({ status: "paid" })]);

    await user.click(screen.getByRole("button", { name: ACTIONS.reverse }));
    const dialog = await screen.findByRole("dialog", { name: `Reverse expense ${NO}` });
    await user.click(within(dialog).getByRole("button", { name: "Reverse" }));
    expect(await within(dialog).findByText("This field is required.")).toBeInTheDocument();
    expect(reverseExpense).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText("Reason"), "Paid twice");
    await user.click(within(dialog).getByRole("button", { name: "Reverse" }));

    await waitFor(() => {
      expect(reverseExpense).toHaveBeenCalledWith(EXPENSE_ID, "Paid twice");
    });
  });

  it("shows the server's refusal to reverse inline", async () => {
    reverseExpense.mockRejectedValue(
      ruleViolation("status", "Only an approved or paid expense can be reversed."),
    );
    const user = await renderTab([VIEW, APPROVE], [expenseRecord({ status: "approved" })]);

    await user.click(screen.getByRole("button", { name: ACTIONS.reverse }));
    const dialog = await screen.findByRole("dialog", { name: `Reverse expense ${NO}` });
    await user.type(within(dialog).getByLabelText("Reason"), "Mistake");
    await user.click(within(dialog).getByRole("button", { name: "Reverse" }));

    expect(
      await within(dialog).findByText("Only an approved or paid expense can be reversed."),
    ).toBeInTheDocument();
  });
});

describe("expenses tab: create and edit", () => {
  it("offers New expense only with fees.expense.create", async () => {
    await renderTab([VIEW]);
    expect(screen.queryByRole("button", { name: "New expense" })).not.toBeInTheDocument();
  });

  it("creates a draft with its mapped input", async () => {
    createExpense.mockResolvedValue(expenseRecord({ status: "draft" }));
    const user = await renderTab([VIEW, CREATE]);

    await user.click(screen.getByRole("button", { name: "New expense" }));
    const dialog = await screen.findByRole("dialog", { name: "New expense" });
    await user.click(await within(dialog).findByRole("combobox", { name: "Category" }));
    await user.click(await screen.findByRole("option", { name: "STA Stationery" }));
    await user.type(within(dialog).getByLabelText("Description"), "Markers");
    await user.type(within(dialog).getByLabelText("Amount (before tax)"), "250.00");
    await user.type(within(dialog).getByLabelText("Expense date"), "2026-10-07");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createExpense).toHaveBeenCalledWith({
        expenseCategoryId: CATEGORY_ID,
        campusId: null,
        vendorName: null,
        description: "Markers",
        amount: "250.00",
        taxAmount: "0.00",
        expenseDate: "2026-10-07",
        paymentMethod: null,
      });
    });
  });

  it("shows the server's refusal to edit a non-draft as the form's message", async () => {
    updateExpense.mockRejectedValue(ruleViolation("status", FIGURES_FIXED));
    const user = await renderTab([VIEW, UPDATE], [expenseRecord({ status: "draft" })]);

    await user.click(screen.getByRole("button", { name: ACTIONS.edit }));
    const dialog = await screen.findByRole("dialog", { name: "Edit expense" });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText(FIGURES_FIXED)).toBeInTheDocument();
    expect(updateExpense).toHaveBeenCalledWith(
      EXPENSE_ID,
      expect.objectContaining({ amount: "100.00" }),
    );
  });
});
