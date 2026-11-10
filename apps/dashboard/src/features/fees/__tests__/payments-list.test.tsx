import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { renderWithProviders, setUrl } from "@/test-utils";

import { PaymentsHome } from "@/features/fees/payments/payments-home";
import {
  asUser,
  cursorPage,
  listPayments,
  listReceipts,
  listRefunds,
  listSettlementImports,
  listVouchers,
  paymentRecord,
  PAYMENTS_VIEW_PERMISSIONS,
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

async function renderPayments(url = "/fees/payments", keys = PAYMENTS_VIEW_PERMISSIONS) {
  setUrl(url);
  asUser(...keys);
  renderWithProviders(
    <>
      <UserLoaded />
      <PaymentsHome />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

describe("payments page", () => {
  // Before the test body sets its own list: a stub run by the render helper would overwrite it.
  beforeEach(() => {
    stubFeesServices();
  });

  it("lists payments with the server's amounts, method, status and receipt number", async () => {
    listPayments.mockResolvedValue(
      cursorPage([
        paymentRecord({ amount: "1250.50", method: "bank_transfer", reference_no: "TXN-9" }),
      ]),
    );
    await renderPayments();

    const row = (await screen.findByText("RCT-2026-0001")).closest("tr") as HTMLElement;
    expect(within(row).getByText("1,250.50")).toBeInTheDocument();
    expect(within(row).getByText("Bank transfer")).toBeInTheDocument();
    expect(within(row).getByText("Confirmed")).toBeInTheDocument();
    expect(within(row).getByText("TXN-9")).toBeInTheDocument();
  });

  it("sends the method, status, date range and cashier filters it was opened with", async () => {
    await renderPayments(
      "/fees/payments?method=cash&status=confirmed&from=2026-10-01&to=2026-10-31&cashier=me",
    );

    await waitFor(() => {
      expect(listPayments).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "cash",
          status: "confirmed",
          // Offset-aware local days, the upper bound exclusive (the start of 1 November).
          paidAtGte: new Date(2026, 9, 1).toISOString(),
          paidAtLt: new Date(2026, 10, 1).toISOString(),
          // "My collections" is the signed-in user's own id.
          receivedBy: "user-1",
        }),
      );
    });
  });

  it("sends no filter it was not given", async () => {
    await renderPayments();

    await waitFor(() => {
      expect(listPayments).toHaveBeenCalled();
    });
    expect(listPayments).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: undefined,
        status: undefined,
        paidAtGte: undefined,
        paidAtLt: undefined,
        receivedBy: undefined,
      }),
    );
  });

  it("offers the invoice link only to a holder of the invoice read", async () => {
    listPayments.mockResolvedValue(cursorPage([paymentRecord()]));
    await renderPayments("/fees/payments", ["fees.payment.view"]);

    await screen.findByText("RCT-2026-0001");
    expect(
      screen.queryByRole("link", { name: /Open the invoice for receipt/ }),
    ).not.toBeInTheDocument();
  });

  it("links a row to its invoice for a holder of the invoice read", async () => {
    listPayments.mockResolvedValue(cursorPage([paymentRecord()]));
    await renderPayments();

    const link = await screen.findByRole("link", {
      name: "Open the invoice for receipt RCT-2026-0001",
    });
    expect(link).toHaveAttribute("href", "/fees/invoices/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("offers the five sub-tabs and mounts only the open one's list", async () => {
    const user = await renderPayments();

    const tabs = within(screen.getByRole("tablist", { name: "Payments sections" }));
    for (const name of ["Payments", "Receipts", "Vouchers", "Refunds", "Settlement imports"]) {
      expect(tabs.getByRole("tab", { name })).toBeInTheDocument();
    }
    await waitFor(() => {
      expect(listPayments).toHaveBeenCalled();
    });
    expect(listReceipts).not.toHaveBeenCalled();
    expect(listVouchers).not.toHaveBeenCalled();
    expect(listRefunds).not.toHaveBeenCalled();
    expect(listSettlementImports).not.toHaveBeenCalled();

    await user.click(tabs.getByRole("tab", { name: "Receipts" }));
    await waitFor(() => {
      expect(listReceipts).toHaveBeenCalled();
    });
  });
});
