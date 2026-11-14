import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { saveBlob } from "@/lib/helpers";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { renderWithProviders, setUrl } from "@/test-utils";
import type { PermissionKey } from "@schoolhub/types";

import { PaymentsHome } from "@/features/fees/payments/payments-home";
import {
  asUser,
  cursorPage,
  downloadReceipt,
  downloadVoucher,
  listReceipts,
  listVouchers,
  PAYMENTS_VIEW_PERMISSIONS,
  receiptRecord,
  ruleViolation,
  stubFeesServices,
  voidVoucher,
  voucherRecord,
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

const COLLECTOR: PermissionKey[] = [...PAYMENTS_VIEW_PERMISSIONS, "fees.payment.collect"];

async function renderTab(tab: "receipts" | "vouchers", keys: PermissionKey[], rowText: string) {
  setUrl(`/fees/payments?tab=${tab}`);
  jest.mocked(saveBlob).mockReset();
  asUser(...keys);
  renderWithProviders(
    <>
      <UserLoaded />
      <PaymentsHome />
    </>,
  );
  await screen.findByText(USER_LOADED);
  await screen.findByText(rowText);
  return userEvent.setup();
}

// Runs before every test's own list stub: one run by the render helper would overwrite it.
beforeEach(() => {
  stubFeesServices();
});

const VOID_ROW = { name: "Void voucher 1234567890" } as const;

describe("payments page: vouchers", () => {
  beforeEach(() => {
    listVouchers.mockResolvedValue(
      cursorPage([
        voucherRecord(),
        voucherRecord({
          id: "v2",
          consumer_number: "2222222222",
          status: "paid",
          payment: "d1111111-1111-4111-8111-111111111111",
        }),
      ]),
    );
  });

  it("hides Void on a paid voucher and shows it on an issued one", async () => {
    await renderTab("vouchers", COLLECTOR, "1234567890");

    expect(screen.getByRole("button", VOID_ROW)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Void voucher 2222222222" }),
    ).not.toBeInTheDocument();
  });

  it("hides Void without fees.payment.collect, but still offers the download", async () => {
    await renderTab("vouchers", PAYMENTS_VIEW_PERMISSIONS, "1234567890");

    expect(screen.queryByRole("button", VOID_ROW)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download 1234567890 as PDF" })).toBeInTheDocument();
  });

  it("voids with a required reason and reloads the list", async () => {
    voidVoucher.mockResolvedValue(voucherRecord({ status: "void" }));
    const user = await renderTab("vouchers", COLLECTOR, "1234567890");
    const reads = listVouchers.mock.calls.length;

    await user.click(screen.getByRole("button", VOID_ROW));
    const dialog = await screen.findByRole("dialog", { name: "Void voucher 1234567890" });
    await user.click(within(dialog).getByRole("button", { name: "Void voucher" }));
    expect(await within(dialog).findByText("This field is required.")).toBeInTheDocument();
    expect(voidVoucher).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText("Reason"), "Printed for the wrong family");
    await user.click(within(dialog).getByRole("button", { name: "Void voucher" }));

    await waitFor(() => {
      expect(voidVoucher).toHaveBeenCalledWith(
        "e1111111-1111-4111-8111-111111111111",
        "Printed for the wrong family",
      );
    });
    await waitFor(() => {
      expect(listVouchers.mock.calls.length).toBeGreaterThan(reads);
    });
  });

  it("shows the server's refusal inline when the voucher was paid meanwhile", async () => {
    voidVoucher.mockRejectedValue(
      ruleViolation("status", "A paid voucher cannot be voided. Refund the payment instead."),
    );
    const user = await renderTab("vouchers", COLLECTOR, "1234567890");

    await user.click(screen.getByRole("button", VOID_ROW));
    const dialog = await screen.findByRole("dialog", { name: "Void voucher 1234567890" });
    await user.type(within(dialog).getByLabelText("Reason"), "Wrong family");
    await user.click(within(dialog).getByRole("button", { name: "Void voucher" }));

    expect(
      await within(dialog).findByText(
        "A paid voucher cannot be voided. Refund the payment instead.",
      ),
    ).toBeInTheDocument();
  });

  it("downloads a voucher in the chosen layout and saves it", async () => {
    const blob = new Blob(["%PDF"]);
    downloadVoucher.mockResolvedValue(blob);
    const user = await renderTab("vouchers", COLLECTOR, "1234567890");

    await user.click(screen.getByRole("button", { name: "Download 1234567890 as thermal print" }));

    await waitFor(() => {
      expect(saveBlob).toHaveBeenCalledWith(blob, "1234567890-thermal.pdf");
    });
    expect(downloadVoucher).toHaveBeenCalledWith("e1111111-1111-4111-8111-111111111111", "thermal");
  });
});

describe("payments page: receipts", () => {
  it("downloads a receipt as a PDF and searches by number", async () => {
    listReceipts.mockResolvedValue(cursorPage([receiptRecord()]));
    const blob = new Blob(["%PDF"]);
    downloadReceipt.mockResolvedValue(blob);
    const user = await renderTab("receipts", PAYMENTS_VIEW_PERMISSIONS, "RCP-2026-00001");

    await user.click(screen.getByRole("button", { name: "Download RCP-2026-00001 as PDF" }));

    await waitFor(() => {
      expect(saveBlob).toHaveBeenCalledWith(blob, "RCP-2026-00001-pdf.pdf");
    });
    expect(downloadReceipt).toHaveBeenCalledWith("b1111111-1111-4111-8111-111111111111", "pdf");
    expect(screen.getByRole("textbox", { name: "Search receipts" })).toBeInTheDocument();
  });

  it("says so, with a toast, when a receipt cannot be downloaded", async () => {
    const { toast } = jest.requireMock<{ toast: { error: jest.Mock } }>("sonner");
    listReceipts.mockResolvedValue(cursorPage([receiptRecord()]));
    downloadReceipt.mockRejectedValue(new Error("down"));
    const user = await renderTab("receipts", PAYMENTS_VIEW_PERMISSIONS, "RCP-2026-00001");

    await user.click(screen.getByRole("button", { name: "Download RCP-2026-00001 as PDF" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("RCP-2026-00001 couldn't be downloaded.");
    });
    expect(saveBlob).not.toHaveBeenCalled();
  });
});
