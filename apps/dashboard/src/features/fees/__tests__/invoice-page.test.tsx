import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@schoolhub/api-client";
import { renderWithProviders } from "@/test-utils";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";

import { InvoicePage } from "@/features/fees/invoices/detail/invoice-page";
import {
  asUser,
  cancelFeeInvoice,
  fetchFeeInvoice,
  INVOICE_ID,
  INVOICING_PERMISSIONS,
  invoiceRecord,
  listPayments,
  listVouchers,
  paymentRecord,
  ruleViolation,
  stubFeesServices,
  voucherRecord,
  cursorPage,
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

async function renderPage() {
  renderWithProviders(
    <>
      <UserLoaded />
      <InvoicePage invoiceId={INVOICE_ID} />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

const CANCEL = "Cancel invoice";

describe("invoice page", () => {
  beforeEach(() => {
    stubFeesServices(`/fees/invoices/${INVOICE_ID}`);
  });

  it("shows the lines and the server's totals, never a sum of its own", async () => {
    // The totals deliberately disagree with the lines: the screen must show the fields it was sent.
    fetchFeeInvoice.mockResolvedValue(
      invoiceRecord({
        subtotal: "1500.00",
        discount_total: "250.00",
        fine_total: "75.50",
        paid_total: "0.00",
        balance_due: "1325.50",
      }),
    );
    asUser("fees.invoice.view");
    await renderPage();

    const table = await screen.findByRole("table", { name: "Invoice lines and totals" });
    const rows = within(table);
    expect(rows.getByText("Tuition fee")).toBeInTheDocument();
    expect(rows.getByText("Library fine")).toBeInTheDocument();
    expect(rows.getByText("Fine")).toBeInTheDocument();
    for (const [label, value] of [
      ["Subtotal", "1,500.00"],
      ["Discounts", "250.00"],
      ["Fines", "75.50"],
      ["Paid", "0.00"],
      ["Balance due", "1,325.50"],
    ] as const) {
      const row = rows.getByText(label).closest("tr");
      expect(row).not.toBeNull();
      expect(within(row as HTMLElement).getByText(value)).toBeInTheDocument();
    }
  });

  it("reads payments and vouchers only for a holder of the payment view key", async () => {
    asUser("fees.invoice.view");
    await renderPage();

    await screen.findByText("Invoice INV-2026-0001");
    expect(screen.queryByText("Payments")).not.toBeInTheDocument();
    expect(listPayments).not.toHaveBeenCalled();
    expect(listVouchers).not.toHaveBeenCalled();
  });

  it("shows the payments with their receipt numbers and the vouchers, read-only", async () => {
    listPayments.mockResolvedValue(cursorPage([paymentRecord()]));
    listVouchers.mockResolvedValue(cursorPage([voucherRecord()]));
    asUser("fees.invoice.view", "fees.payment.view");
    await renderPage();

    const payments = await screen.findByRole("table", { name: "Payments against this invoice" });
    expect(within(payments).getByText("RCT-2026-0001")).toBeInTheDocument();
    expect(within(payments).getByText("500.00")).toBeInTheDocument();
    expect(within(payments).getByText("Cash")).toBeInTheDocument();
    expect(listPayments).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: INVOICE_ID }));
    const vouchers = await screen.findByRole("table", {
      name: "Vouchers issued for this invoice",
    });
    expect(within(vouchers).getByText("1234567890")).toBeInTheDocument();
    expect(listVouchers).toHaveBeenCalledWith(expect.objectContaining({ invoice: INVOICE_ID }));
  });

  it.each([
    ["without the update key", ["fees.invoice.view"], invoiceRecord()],
    [
      "once money is paid",
      INVOICING_PERMISSIONS,
      invoiceRecord({ status: "partially_paid", paid_total: "500.00", balance_due: "850.00" }),
    ],
    [
      "once canceled",
      INVOICING_PERMISSIONS,
      invoiceRecord({ status: "canceled", canceled_reason: "Raised in error" }),
    ],
  ] as const)("offers no Cancel %s", async (_label, keys, invoice) => {
    fetchFeeInvoice.mockResolvedValue(invoice);
    asUser(...keys);
    await renderPage();

    await screen.findByText("Invoice INV-2026-0001");
    expect(screen.queryByRole("button", { name: CANCEL })).not.toBeInTheDocument();
  });

  it("says why a canceled invoice was canceled", async () => {
    fetchFeeInvoice.mockResolvedValue(
      invoiceRecord({ status: "canceled", canceled_reason: "Raised in error" }),
    );
    asUser(...INVOICING_PERMISSIONS);
    await renderPage();

    expect(await screen.findByText("Canceled: Raised in error")).toBeInTheDocument();
  });

  it("cancels an unpaid invoice with a reason", async () => {
    cancelFeeInvoice.mockResolvedValue(invoiceRecord({ status: "canceled" }));
    asUser(...INVOICING_PERMISSIONS);
    const user = await renderPage();

    await user.click(await screen.findByRole("button", { name: CANCEL }));
    const dialog = await screen.findByRole("dialog", { name: "Cancel invoice INV-2026-0001" });
    await user.type(within(dialog).getByLabelText("Reason"), "Raised in error");
    await user.click(within(dialog).getByRole("button", { name: CANCEL }));

    await waitFor(() => {
      expect(cancelFeeInvoice).toHaveBeenCalledWith(INVOICE_ID, "Raised in error");
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("requires a reason before it asks the server", async () => {
    asUser(...INVOICING_PERMISSIONS);
    const user = await renderPage();

    await user.click(await screen.findByRole("button", { name: CANCEL }));
    const dialog = await screen.findByRole("dialog", { name: "Cancel invoice INV-2026-0001" });
    await user.click(within(dialog).getByRole("button", { name: CANCEL }));

    expect(await within(dialog).findByText("This field is required.")).toBeInTheDocument();
    expect(cancelFeeInvoice).not.toHaveBeenCalled();
  });

  it("shows the server's 422 inline, and keeps the dialog open, when a payment landed meanwhile", async () => {
    const refusal =
      "500.00 has been paid against this invoice. Refund the payment rather than cancelling the charge.";
    cancelFeeInvoice.mockRejectedValue(ruleViolation("status", refusal));
    asUser(...INVOICING_PERMISSIONS);
    const user = await renderPage();

    await user.click(await screen.findByRole("button", { name: CANCEL }));
    const dialog = await screen.findByRole("dialog", { name: "Cancel invoice INV-2026-0001" });
    await user.type(within(dialog).getByLabelText("Reason"), "Raised in error");
    await user.click(within(dialog).getByRole("button", { name: CANCEL }));

    expect(await within(dialog).findByText(refusal)).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Cancel invoice INV-2026-0001" }),
    ).toBeInTheDocument();
  });

  it("says so, with a way back, for an invoice the API cannot find", async () => {
    fetchFeeInvoice.mockRejectedValue(
      new ApiError({ status: 404, code: "not_found", message: "Not found.", url: "/fee-invoices" }),
    );
    asUser("fees.invoice.view");
    await renderPage();

    expect(await screen.findByText("Invoice not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to invoices" })).toHaveAttribute(
      "href",
      "/fees/invoices",
    );
  });
});
