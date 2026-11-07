import { screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { StudentRecord } from "@/services";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { renderWithProviders } from "@/test-utils";

import { InvoicesHome } from "@/features/fees/invoices/invoices-home";
import {
  asUser,
  createFeeInvoice,
  cursorPage,
  fetchStudentsPage,
  INVOICING_PERMISSIONS,
  invoiceRecord,
  ruleViolation,
  SESSION_ID,
  STUDENT_ID,
  stubFeesServices,
} from "./fees-test-support";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => object }>("@/test-utils");
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

const STUDENT = {
  id: STUDENT_ID,
  first_name: "Ayesha",
  last_name: "Khan",
  admission_number: "ADM-1042",
} as StudentRecord;

async function openDialog() {
  renderWithProviders(
    <>
      <UserLoaded />
      <InvoicesHome />
    </>,
  );
  await screen.findByText(USER_LOADED);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "New invoice" }));
  const dialog = await screen.findByRole("dialog", { name: "New invoice" });
  return { user, dialog };
}

async function fill(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.click(within(dialog).getByRole("button", { name: "Choose a student" }));
  await user.click(await screen.findByRole("button", { name: /Ayesha Khan/ }));
  await user.click(await within(dialog).findByRole("combobox", { name: "Session" }));
  await user.click(await screen.findByRole("option", { name: "2026-27" }));
  fireEvent.change(within(dialog).getByLabelText("Due date"), { target: { value: "2026-10-20" } });
}

describe("new invoice", () => {
  beforeEach(() => {
    stubFeesServices("/fees/invoices");
    asUser(...INVOICING_PERMISSIONS);
    fetchStudentsPage.mockResolvedValue(cursorPage([STUDENT]));
    createFeeInvoice.mockResolvedValue(invoiceRecord());
  });

  it("raises an ad-hoc invoice for the chosen student", async () => {
    const { user, dialog } = await openDialog();
    fireEvent.change(within(dialog).getByLabelText("Issue date"), {
      target: { value: "2026-10-01" },
    });
    await fill(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createFeeInvoice).toHaveBeenCalledWith({
        studentId: STUDENT_ID,
        academicSessionId: SESSION_ID,
        issueDate: "2026-10-01",
        dueDate: "2026-10-20",
        periodLabel: "",
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("refuses a due date before the issue date without asking the server", async () => {
    const { user, dialog } = await openDialog();
    fireEvent.change(within(dialog).getByLabelText("Issue date"), {
      target: { value: "2026-10-30" },
    });
    await fill(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await within(dialog).findByText("The due date can't be before the issue date."),
    ).toBeInTheDocument();
    expect(createFeeInvoice).not.toHaveBeenCalled();
  });

  it("shows the server's refusal inline and keeps the dialog open", async () => {
    createFeeInvoice.mockRejectedValue(
      ruleViolation("academic_session", "This session is closed.", 400),
    );
    const { user, dialog } = await openDialog();
    await fill(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("This session is closed.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "New invoice" })).toBeInTheDocument();
  });
});
