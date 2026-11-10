import type * as ReactModule from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { saveBlob } from "@/lib/helpers";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { renderWithProviders } from "@/test-utils";

import { CounterHome } from "@/features/fees/counter/counter-home";
import {
  asUser,
  COUNTER_PERMISSIONS,
  cursorPage,
  downloadReceipt,
  INVOICE_ID,
  invoiceRecord,
  listFeeInvoices,
  paymentRecord,
  recordPayment,
  ruleViolation,
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

jest.mock("@/lib/helpers", () => ({
  ...jest.requireActual<Record<string, unknown>>("@/lib/helpers"),
  saveBlob: jest.fn(),
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ feesServicesMock: () => unknown }>("./fees-services-mock")
    .feesServicesMock(),
);

// The picker searches the students list; a stand-in that picks one student keeps this file on the counter.
jest.mock("@/components/student-picker", () => {
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

async function renderCounter() {
  renderWithProviders(
    <>
      <UserLoaded />
      <CounterHome />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

/** Picks the student and opens Record payment on the one outstanding invoice. */
async function openDialog() {
  const user = await renderCounter();
  await user.click(screen.getByRole("button", { name: "Choose a student" }));
  await user.click(await screen.findByRole("button", { name: /Record payment for INV-2026-0001/ }));
  const dialog = await screen.findByRole("dialog", { name: "Record payment: INV-2026-0001" });
  return { user, dialog };
}

const SUBMIT = { name: "Record payment" } as const;

describe("fee counter", () => {
  beforeEach(() => {
    stubFeesServices("/fees/counter");
    jest.mocked(saveBlob).mockReset();
    asUser(...COUNTER_PERMISSIONS);
  });

  it("lists the picked student's outstanding invoices with the server's balances", async () => {
    const user = await renderCounter();
    expect(listFeeInvoices).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Choose a student" }));

    const row = (await screen.findByText("INV-2026-0001")).closest("tr");
    expect(row).not.toBeNull();
    // The server's own figure, formatted: the lines (1,500 + 50) are never summed here.
    expect(within(row as HTMLElement).getByText("1,350.00")).toBeInTheDocument();
    expect(listFeeInvoices).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: STUDENT_ID, outstanding: true }),
    );
  });

  it("links the picked student to their statement", async () => {
    const user = await renderCounter();
    expect(screen.queryByRole("link", { name: "View statement" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Choose a student" }));

    const link = await screen.findByRole("link", { name: "View statement" });
    expect(link).toHaveAttribute("href", `/fees/students/${STUDENT_ID}/ledger`);
  });

  it("records the whole balance in cash by default, with one Idempotency-Key", async () => {
    recordPayment.mockResolvedValue(paymentRecord({ amount: "1350.00" }));
    const { user, dialog } = await openDialog();
    expect(within(dialog).getByLabelText("Amount")).toHaveValue("1350.00");

    await user.click(within(dialog).getByRole("button", SUBMIT));

    await waitFor(() => {
      expect(recordPayment).toHaveBeenCalledTimes(1);
    });
    expect(recordPayment).toHaveBeenCalledWith(
      { feeInvoiceId: INVOICE_ID, amount: "1350.00", method: "cash", referenceNo: null },
      expect.stringMatching(/\S+/),
    );
    expect(
      await within(dialog).findByText("Payment of 1,350.00 recorded. Receipt RCT-2026-0001."),
    ).toBeInTheDocument();
  });

  it("offers every method but the online gateway", async () => {
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByRole("combobox", { name: "Method" }));

    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(options).toEqual(["Cash", "Cheque", "Bank transfer", "Card"]);
  });

  it("shows the server's over-balance refusal on the amount, and keeps the dialog open", async () => {
    recordPayment.mockRejectedValue(
      ruleViolation("amount", "2000.00 exceeds the 1350.00 outstanding on INV-2026-0001."),
    );
    const { user, dialog } = await openDialog();
    await user.clear(within(dialog).getByLabelText("Amount"));
    await user.type(within(dialog).getByLabelText("Amount"), "2000.00");

    await user.click(within(dialog).getByRole("button", SUBMIT));

    const message = await within(dialog).findByText(
      "2000.00 exceeds the 1350.00 outstanding on INV-2026-0001.",
    );
    expect(within(dialog).getByLabelText("Amount")).toHaveAccessibleDescription(
      message.textContent,
    );
    expect(dialog).toBeVisible();
  });

  it("shows a canceled invoice's refusal as the form's message", async () => {
    recordPayment.mockRejectedValue(
      ruleViolation("fee_invoice", "INV-2026-0001 is canceled and takes no payment."),
    );
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByRole("button", SUBMIT));

    expect(
      await within(dialog).findByText("INV-2026-0001 is canceled and takes no payment."),
    ).toBeInTheDocument();
  });

  it("asks for a reference before sending a cheque", async () => {
    recordPayment.mockResolvedValue(paymentRecord({ method: "cheque" }));
    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole("combobox", { name: "Method" }));
    await user.click(await screen.findByRole("option", { name: "Cheque" }));

    await user.click(within(dialog).getByRole("button", SUBMIT));
    expect(
      await within(dialog).findByText("Enter the cheque or transfer reference."),
    ).toBeVisible();
    expect(recordPayment).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText("Reference number"), "CHQ-77");
    await user.click(within(dialog).getByRole("button", SUBMIT));
    await waitFor(() => {
      expect(recordPayment).toHaveBeenCalledWith(
        expect.objectContaining({ method: "cheque", referenceNo: "CHQ-77" }),
        expect.any(String),
      );
    });
  });

  it("sends one request and one key for two submits while the first is in flight", async () => {
    let settle: (payment: ReturnType<typeof paymentRecord>) => void = () => undefined;
    recordPayment.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const { user, dialog } = await openDialog();
    const form = dialog.querySelector("form") as HTMLFormElement;

    await user.click(within(dialog).getByRole("button", SUBMIT));
    fireEvent.submit(form);
    fireEvent.submit(form);
    settle(paymentRecord());

    await within(dialog).findByText(/Payment of 500.00 recorded/);
    expect(recordPayment).toHaveBeenCalledTimes(1);
  });

  it("reuses the key when the same payment is retried after a network failure", async () => {
    recordPayment
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(paymentRecord());
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByRole("button", SUBMIT));
    expect(
      await within(dialog).findByText("Something went wrong. Please try again."),
    ).toBeVisible();
    await user.click(within(dialog).getByRole("button", SUBMIT));

    await within(dialog).findByText(/Payment of 500.00 recorded/);
    expect(recordPayment).toHaveBeenCalledTimes(2);
    const [first, second] = recordPayment.mock.calls;
    expect(first?.[1]).toBeTruthy();
    expect(second?.[1]).toBe(first?.[1]);
  });

  it("takes a fresh key once the amount changes after a failure", async () => {
    recordPayment
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(paymentRecord());
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByRole("button", SUBMIT));
    await within(dialog).findByText("Something went wrong. Please try again.");
    await user.clear(within(dialog).getByLabelText("Amount"));
    await user.type(within(dialog).getByLabelText("Amount"), "100.00");
    await user.click(within(dialog).getByRole("button", SUBMIT));

    await within(dialog).findByText(/Payment of 500.00 recorded/);
    const [first, second] = recordPayment.mock.calls;
    expect(second?.[1]).not.toBe(first?.[1]);
  });

  it.each([
    ["Print PDF", "pdf"],
    ["Print thermal", "thermal"],
  ] as const)("%s downloads the receipt in that format and saves it", async (name, format) => {
    const blob = new Blob(["%PDF"]);
    recordPayment.mockResolvedValue(paymentRecord());
    downloadReceipt.mockResolvedValue(blob);
    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole("button", SUBMIT));

    await user.click(await within(dialog).findByRole("button", { name }));

    await waitFor(() => {
      expect(saveBlob).toHaveBeenCalledWith(blob, `RCT-2026-0001-${format}.pdf`);
    });
    expect(downloadReceipt).toHaveBeenCalledWith("b1111111-1111-4111-8111-111111111111", format);
  });

  it("says so when the receipt download fails", async () => {
    recordPayment.mockResolvedValue(paymentRecord());
    downloadReceipt.mockRejectedValue(new Error("down"));
    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole("button", SUBMIT));

    await user.click(await within(dialog).findByRole("button", { name: "Print PDF" }));

    expect(
      await within(dialog).findByText("We couldn't download the receipt. Please try again."),
    ).toBeVisible();
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it("says the receipt is still being issued when the payment carries none, and links the payments list", async () => {
    recordPayment.mockResolvedValue(paymentRecord({ receipt: null }));
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByRole("button", SUBMIT));

    expect(await within(dialog).findByText(/The receipt is still being issued/)).toBeVisible();
    expect(within(dialog).queryByRole("button", { name: "Print PDF" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Open the payments list" })).toHaveAttribute(
      "href",
      "/fees/payments",
    );
  });

  it("offers no print without fees.payment.view, the key the receipt streams behind", async () => {
    asUser("fees.payment.collect", "fees.invoice.view", "students.student.view");
    recordPayment.mockResolvedValue(paymentRecord());
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByRole("button", SUBMIT));

    expect(await within(dialog).findByText(/The receipt has been issued/)).toBeVisible();
    expect(within(dialog).queryByRole("button", { name: "Print PDF" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Print thermal" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("link")).not.toBeInTheDocument();
  });

  it("reloads the invoices after a payment, so the balance is the server's new one", async () => {
    recordPayment.mockResolvedValue(paymentRecord());
    const { user, dialog } = await openDialog();
    const reads = listFeeInvoices.mock.calls.length;

    listFeeInvoices.mockResolvedValue(
      cursorPage([invoiceRecord({ paid_total: "500.00", balance_due: "850.00" })]),
    );
    await user.click(within(dialog).getByRole("button", SUBMIT));

    await waitFor(() => {
      expect(listFeeInvoices.mock.calls.length).toBeGreaterThan(reads);
    });
    expect(await screen.findByText("850.00")).toBeInTheDocument();
  });
});

describe("fee counter gating", () => {
  beforeEach(() => {
    stubFeesServices("/fees/counter");
  });

  it("offers no Record without the collect key", async () => {
    asUser("fees.invoice.view", "students.student.view");
    const user = await renderCounter();

    await user.click(screen.getByRole("button", { name: "Choose a student" }));

    expect(await screen.findByText("INV-2026-0001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Record payment/ })).not.toBeInTheDocument();
  });

  it.each([
    ["students.student.view", ["fees.payment.collect", "fees.invoice.view"]],
    ["fees.invoice.view", ["fees.payment.collect", "students.student.view"]],
  ] as const)("without %s explains itself and reads nothing", async (_missing, keys) => {
    asUser(...keys);
    await renderCounter();

    expect(await screen.findByText("The counter isn't available to you")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose a student" })).not.toBeInTheDocument();
    expect(listFeeInvoices).not.toHaveBeenCalled();
  });
});
