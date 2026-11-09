import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@schoolhub/api-client";
import type { PermissionKey } from "@schoolhub/types";
import { renderWithProviders } from "@/test-utils";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";

import { InvoicePage } from "@/features/fees/invoices/detail/invoice-page";
import {
  asUser,
  createRefund,
  cursorPage,
  fetchFeeInvoice,
  INVOICE_ID,
  invoiceRecord,
  issueVoucher,
  listPayments,
  paymentRecord,
  recordPayment,
  refundRecord,
  ruleViolation,
  stubFeesServices,
  voucherRecord,
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

const COLLECTOR: PermissionKey[] = [
  "fees.invoice.view",
  "fees.payment.view",
  "fees.payment.collect",
];
const REFUNDER: PermissionKey[] = [...COLLECTOR, "fees.payment.refund"];

async function renderPage(keys: PermissionKey[]) {
  asUser(...keys);
  renderWithProviders(
    <>
      <UserLoaded />
      <InvoicePage invoiceId={INVOICE_ID} />
    </>,
  );
  await screen.findByText(USER_LOADED);
  await screen.findByText("Invoice INV-2026-0001");
  return userEvent.setup();
}

const RECORD = { name: "Record payment" } as const;
const ISSUE = { name: "Issue voucher" } as const;

describe("invoice page: collection actions", () => {
  beforeEach(() => {
    stubFeesServices(`/fees/invoices/${INVOICE_ID}`);
  });

  it.each([
    ["issued", true],
    ["partially_paid", true],
    ["overdue", true],
    ["draft", false],
    ["paid", false],
    ["canceled", false],
  ] as const)(
    "offers Record payment and Issue voucher on a %s invoice: %s",
    async (status, shown) => {
      fetchFeeInvoice.mockResolvedValue(invoiceRecord({ status }));
      await renderPage(COLLECTOR);

      expect(screen.queryByRole("button", RECORD) !== null).toBe(shown);
      expect(screen.queryByRole("button", ISSUE) !== null).toBe(shown);
    },
  );

  it("offers neither without fees.payment.collect", async () => {
    await renderPage(["fees.invoice.view", "fees.payment.view"]);

    expect(screen.queryByRole("button", RECORD)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", ISSUE)).not.toBeInTheDocument();
  });

  it("records a payment against the invoice with one Idempotency-Key and shows its receipt", async () => {
    recordPayment.mockResolvedValue(paymentRecord({ amount: "1350.00" }));
    const user = await renderPage(COLLECTOR);

    await user.click(screen.getByRole("button", RECORD));
    const dialog = await screen.findByRole("dialog", { name: "Record payment: INV-2026-0001" });
    expect(within(dialog).getByLabelText("Amount")).toHaveValue("1350.00");
    await user.click(within(dialog).getByRole("button", RECORD));

    await waitFor(() => {
      expect(recordPayment).toHaveBeenCalledWith(
        { feeInvoiceId: INVOICE_ID, amount: "1350.00", method: "cash", referenceNo: null },
        expect.stringMatching(/\S+/),
      );
    });
    expect(
      await within(dialog).findByText("Payment of 1,350.00 recorded. Receipt RCT-2026-0001."),
    ).toBeInTheDocument();
  });

  it("issues a voucher for the invoice, leaving the validity to the school's default", async () => {
    issueVoucher.mockResolvedValue(voucherRecord());
    const user = await renderPage(COLLECTOR);

    await user.click(screen.getByRole("button", ISSUE));
    const dialog = await screen.findByRole("dialog", { name: "Issue voucher: INV-2026-0001" });
    await user.click(within(dialog).getByRole("button", ISSUE));

    await waitFor(() => {
      expect(issueVoucher).toHaveBeenCalledWith(INVOICE_ID, {
        provider: "bank_branch",
        validityDays: null,
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("sends the validity when one is typed, and checks it before it asks the server", async () => {
    issueVoucher.mockResolvedValue(voucherRecord());
    const user = await renderPage(COLLECTOR);

    await user.click(screen.getByRole("button", ISSUE));
    const dialog = await screen.findByRole("dialog", { name: "Issue voucher: INV-2026-0001" });
    await user.type(within(dialog).getByLabelText("Valid for (days)"), "400");
    await user.click(within(dialog).getByRole("button", ISSUE));
    expect(
      await within(dialog).findByText("Enter a whole number of days, from 1 to 365."),
    ).toBeInTheDocument();
    expect(issueVoucher).not.toHaveBeenCalled();

    await user.clear(within(dialog).getByLabelText("Valid for (days)"));
    await user.type(within(dialog).getByLabelText("Valid for (days)"), "30");
    await user.click(within(dialog).getByRole("button", ISSUE));

    await waitFor(() => {
      expect(issueVoucher).toHaveBeenCalledWith(INVOICE_ID, {
        provider: "bank_branch",
        validityDays: 30,
      });
    });
  });

  it("shows the server's refusal inline when the invoice was settled meanwhile", async () => {
    issueVoucher.mockRejectedValue(
      ruleViolation("fee_invoice", "INV-2026-0001 is settled; there is nothing to collect."),
    );
    const user = await renderPage(COLLECTOR);

    await user.click(screen.getByRole("button", ISSUE));
    const dialog = await screen.findByRole("dialog", { name: "Issue voucher: INV-2026-0001" });
    await user.click(within(dialog).getByRole("button", ISSUE));

    expect(
      await within(dialog).findByText("INV-2026-0001 is settled; there is nothing to collect."),
    ).toBeInTheDocument();
  });
});

describe("invoice page: request refund", () => {
  const REQUEST_ROW = { name: "Request a refund for receipt RCT-2026-0001" } as const;

  beforeEach(() => {
    stubFeesServices(`/fees/invoices/${INVOICE_ID}`);
    listPayments.mockResolvedValue(
      cursorPage([
        paymentRecord(),
        paymentRecord({ id: "d2", receipt_no: "RCT-2026-0002", status: "reversed" }),
      ]),
    );
  });

  it("offers Request refund on a confirmed payment only, and only with fees.payment.refund", async () => {
    await renderPage(REFUNDER);
    await screen.findByText("RCT-2026-0002");

    expect(screen.getAllByRole("button", { name: /Request a refund for receipt/ })).toHaveLength(1);
    expect(screen.getByRole("button", REQUEST_ROW)).toBeInTheDocument();
  });

  it("offers none without the refund key", async () => {
    await renderPage(COLLECTOR);
    await screen.findByText("RCT-2026-0001");

    expect(screen.queryByRole("button", { name: /Request a refund/ })).not.toBeInTheDocument();
  });

  it("files the request with the payment's id and one Idempotency-Key, then says it awaits an approver", async () => {
    createRefund.mockResolvedValue(refundRecord({ amount: "200.00" }));
    const user = await renderPage(REFUNDER);

    await user.click(await screen.findByRole("button", REQUEST_ROW));
    const dialog = await screen.findByRole("dialog", { name: "Request refund: RCT-2026-0001" });
    expect(within(dialog).getByLabelText("Amount to refund")).toHaveValue("500.00");
    await user.clear(within(dialog).getByLabelText("Amount to refund"));
    await user.type(within(dialog).getByLabelText("Amount to refund"), "200.00");
    await user.type(within(dialog).getByLabelText("Reason"), "Charged twice");
    await user.click(within(dialog).getByRole("button", { name: "Request refund" }));

    await waitFor(() => {
      expect(createRefund).toHaveBeenCalledWith(
        {
          paymentId: "d1111111-1111-4111-8111-111111111111",
          amount: "200.00",
          reason: "Charged twice",
        },
        expect.stringMatching(/\S+/),
      );
    });
    expect(
      await within(dialog).findByText("Refund of 200.00 requested. It now awaits an approver."),
    ).toBeInTheDocument();
  });

  it("shows the server's over-limit refusal on the amount with the refundable remainder from meta", async () => {
    createRefund.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "domain_rule_violation",
        message: "600.00 exceeds the 300.00 still refundable on this payment.",
        url: "/refunds:create",
        details: [
          { field: "amount", issue: "600.00 exceeds the 300.00 still refundable on this payment." },
        ],
        meta: { refundable_remainder: "300.00" },
      }),
    );
    const user = await renderPage(REFUNDER);

    await user.click(await screen.findByRole("button", REQUEST_ROW));
    const dialog = await screen.findByRole("dialog", { name: "Request refund: RCT-2026-0001" });
    await user.clear(within(dialog).getByLabelText("Amount to refund"));
    await user.type(within(dialog).getByLabelText("Amount to refund"), "600.00");
    await user.type(within(dialog).getByLabelText("Reason"), "Charged twice");
    await user.click(within(dialog).getByRole("button", { name: "Request refund" }));

    const amount = within(dialog).getByLabelText("Amount to refund");
    expect(
      await within(dialog).findByText(
        "600.00 exceeds the 300.00 still refundable on this payment.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("At most 300.00 can still be refunded on this payment."),
    ).toBeInTheDocument();
    expect(amount).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByRole("dialog", { name: "Request refund: RCT-2026-0001" }),
    ).toBeInTheDocument();
  });

  it("reuses the Idempotency-Key when the same request is retried after a failure", async () => {
    createRefund.mockRejectedValueOnce(new Error("network down"));
    createRefund.mockResolvedValue(refundRecord());
    const user = await renderPage(REFUNDER);

    await user.click(await screen.findByRole("button", REQUEST_ROW));
    const dialog = await screen.findByRole("dialog", { name: "Request refund: RCT-2026-0001" });
    await user.type(within(dialog).getByLabelText("Reason"), "Charged twice");
    await user.click(within(dialog).getByRole("button", { name: "Request refund" }));
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Request refund" }));

    await waitFor(() => {
      expect(createRefund).toHaveBeenCalledTimes(2);
    });
    const keys = createRefund.mock.calls.map(([, key]) => key);
    expect(keys[1]).toBe(keys[0]);
  });

  it("requires a reason and a positive amount before it asks the server", async () => {
    const user = await renderPage(REFUNDER);

    await user.click(await screen.findByRole("button", REQUEST_ROW));
    const dialog = await screen.findByRole("dialog", { name: "Request refund: RCT-2026-0001" });
    await user.clear(within(dialog).getByLabelText("Amount to refund"));
    await user.type(within(dialog).getByLabelText("Amount to refund"), "0");
    await user.click(within(dialog).getByRole("button", { name: "Request refund" }));

    expect(await within(dialog).findAllByText("This field is required.")).toHaveLength(1);
    expect(
      within(dialog).getByText("Enter a positive amount with at most two decimals."),
    ).toBeInTheDocument();
    expect(createRefund).not.toHaveBeenCalled();
  });
});
