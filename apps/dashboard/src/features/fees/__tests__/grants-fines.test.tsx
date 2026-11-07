import type * as ReactModule from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { renderWithProviders } from "@/test-utils";

import { FinesTab } from "@/features/fees/grants/fines-tab";
import {
  asUser,
  cursorPage,
  fetchFeeHeadOptions,
  headRecord,
  HEAD_ID,
  rowOf,
  ruleViolation,
} from "./fees-test-support";
import {
  createFine,
  FINE_ID,
  fineRecord,
  GRANTS_PERMISSIONS,
  listFines,
  stubGrantsServices,
  waiveFine,
} from "./grants-test-support";

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

// The picker searches the students list; a stand-in that picks one student keeps this file on the form.
jest.mock("@/features/communication/messages/student-picker", () => {
  const react = jest.requireActual<typeof ReactModule>("react");
  return {
    StudentPicker: ({ onChange }: { onChange: (value: { id: string; name: string }) => void }) =>
      react.createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            onChange({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Ayesha Khan" });
          },
        },
        "Choose a student",
      ),
  };
});

const FINE_HEAD_ID = "77777777-7777-4777-8777-777777777778";

async function renderTab() {
  renderWithProviders(
    <>
      <UserLoaded />
      <FinesTab />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

describe("fines tab", () => {
  beforeEach(() => {
    stubGrantsServices("/fees/grants?tab=fines");
  });

  it("shows each fine with its amount, head and status as the server sent them", async () => {
    asUser("fees.fine.view", "fees.fee-structure.view");
    await renderTab();

    await screen.findByText("Overdue library book");
    const row = rowOf("Overdue library book");
    expect(row.getByText("Ayesha Khan")).toBeInTheDocument();
    expect(row.getByText("250.00")).toBeInTheDocument();
    expect(row.getByText("Library")).toBeInTheDocument();
    expect(row.getByText("Pending")).toBeInTheDocument();
    expect(await row.findByText("Library fee")).toBeInTheDocument();
  });

  it("offers Waive only on a pending fine, and only to a holder of the waive key", async () => {
    listFines.mockResolvedValue(
      cursorPage([
        fineRecord(),
        fineRecord({
          id: "d0000000-0000-4000-8000-000000000021",
          reason: "Invoiced one",
          status: "invoiced",
        }),
        fineRecord({
          id: "d0000000-0000-4000-8000-000000000022",
          reason: "Waived one",
          status: "waived",
        }),
        fineRecord({
          id: "d0000000-0000-4000-8000-000000000023",
          reason: "Paid one",
          status: "paid",
        }),
      ]),
    );
    asUser("fees.fine.view", "fees.fine.waive");
    await renderTab();

    await screen.findByText("Paid one");
    expect(screen.getAllByRole("button", { name: /^Waive fine for / })).toHaveLength(1);
    expect(
      rowOf("Overdue library book").getByRole("button", { name: "Waive fine for Ayesha Khan" }),
    ).toBeInTheDocument();
  });

  it("hides Waive and Raise from a viewer holding only the view key", async () => {
    asUser("fees.fine.view");
    await renderTab();

    await screen.findByText("Overdue library book");
    expect(screen.queryByRole("button", { name: /^Waive/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Raise fine" })).not.toBeInTheDocument();
  });

  it("hides Raise from a creator who cannot read the fee heads the form requires", async () => {
    asUser("fees.fine.view", "fees.fine.create", "students.student.view");
    await renderTab();

    await screen.findByText("Overdue library book");
    expect(screen.queryByRole("button", { name: "Raise fine" })).not.toBeInTheDocument();
  });

  it("waives with the reason typed", async () => {
    waiveFine.mockResolvedValue(fineRecord({ status: "waived" }));
    asUser(...GRANTS_PERMISSIONS);
    const user = await renderTab();

    await user.click(await screen.findByRole("button", { name: "Waive fine for Ayesha Khan" }));
    const dialog = await screen.findByRole("dialog", { name: "Waive fine for Ayesha Khan" });
    await user.type(within(dialog).getByLabelText("Reason"), "Hardship");
    await user.click(within(dialog).getByRole("button", { name: "Waive fine" }));

    await waitFor(() => {
      expect(waiveFine).toHaveBeenCalledWith(FINE_ID, "Hardship");
    });
  });

  it("requires a reason before it asks the server", async () => {
    asUser(...GRANTS_PERMISSIONS);
    const user = await renderTab();

    await user.click(await screen.findByRole("button", { name: "Waive fine for Ayesha Khan" }));
    const dialog = await screen.findByRole("dialog", { name: "Waive fine for Ayesha Khan" });
    await user.click(within(dialog).getByRole("button", { name: "Waive fine" }));

    expect(await within(dialog).findByText("This field is required.")).toBeInTheDocument();
    expect(waiveFine).not.toHaveBeenCalled();
  });

  it("shows the server's refusal inline, and keeps the dialog open, when the fine was invoiced meanwhile", async () => {
    const refusal =
      "This fine is invoiced. Only a pending fine can be waived; an invoiced one needs an adjustment or a cancellation.";
    waiveFine.mockRejectedValue(ruleViolation("status", refusal));
    asUser(...GRANTS_PERMISSIONS);
    const user = await renderTab();

    await user.click(await screen.findByRole("button", { name: "Waive fine for Ayesha Khan" }));
    const dialog = await screen.findByRole("dialog", { name: "Waive fine for Ayesha Khan" });
    await user.type(within(dialog).getByLabelText("Reason"), "Hardship");
    await user.click(within(dialog).getByRole("button", { name: "Waive fine" }));

    expect(await within(dialog).findByText(refusal)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Waive fine for Ayesha Khan" })).toBeInTheDocument();
  });

  it("raises a fine against the picked student, with a head in the fine category", async () => {
    fetchFeeHeadOptions.mockResolvedValue([
      headRecord({ category: "tuition", name: "Tuition" }),
      headRecord({ id: FINE_HEAD_ID, category: "fine", name: "Fines" }),
    ]);
    createFine.mockResolvedValue(fineRecord());
    asUser(...GRANTS_PERMISSIONS);
    const user = await renderTab();

    await user.click(await screen.findByRole("button", { name: "Raise fine" }));
    const dialog = await screen.findByRole("dialog", { name: "Raise a fine" });
    await user.click(within(dialog).getByRole("button", { name: "Choose a student" }));
    await user.click(screen.getByRole("combobox", { name: "Fee head" }));
    expect(screen.queryByRole("option", { name: "Tuition" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("option", { name: "Fines" }));
    await user.type(within(dialog).getByLabelText("Amount"), "250");
    await user.type(within(dialog).getByLabelText("Reason"), "Overdue library book");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createFine).toHaveBeenCalledWith({
        studentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        feeHeadId: FINE_HEAD_ID,
        fineType: "late_fee",
        amount: "250",
        reason: "Overdue library book",
      });
    });
  });

  it("refuses a non-positive amount before it asks the server", async () => {
    fetchFeeHeadOptions.mockResolvedValue([
      headRecord({ id: HEAD_ID, category: "fine", name: "Fines" }),
    ]);
    asUser(...GRANTS_PERMISSIONS);
    const user = await renderTab();

    await user.click(await screen.findByRole("button", { name: "Raise fine" }));
    const dialog = await screen.findByRole("dialog", { name: "Raise a fine" });
    await user.click(within(dialog).getByRole("button", { name: "Choose a student" }));
    await user.click(screen.getByRole("combobox", { name: "Fee head" }));
    await user.click(await screen.findByRole("option", { name: "Fines" }));
    await user.type(within(dialog).getByLabelText("Amount"), "0");
    await user.type(within(dialog).getByLabelText("Reason"), "x");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("Enter a positive amount.")).toBeInTheDocument();
    expect(createFine).not.toHaveBeenCalled();
  });
});
