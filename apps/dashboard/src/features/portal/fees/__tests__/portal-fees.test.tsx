import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { saveBlob } from "@/lib/helpers";
import { Services } from "@/services";
import {
  AYESHA_ID,
  INVOICE_ID,
  PAID_INVOICE_ID,
  RECEIPT_ID,
  portalInvoice,
  portalReceipt,
} from "@/test-fixtures/portal";
import { renderWithProviders } from "@/test-utils";

import { PortalFees } from "../portal-fees";
import { PortalInvoiceDetail } from "../portal-invoice-detail";

const mockUseParams = jest.fn();

jest.mock("next/navigation", () => ({
  useParams: () => mockUseParams() as unknown,
}));

jest.mock("@/lib/helpers", () => ({
  ...jest.requireActual<Record<string, unknown>>("@/lib/helpers"),
  saveBlob: jest.fn(),
}));

jest.mock("@/services", () => ({
  Services: {
    feeInvoices: { listFeeInvoices: jest.fn(), fetchFeeInvoice: jest.fn() },
    receipts: { listReceipts: jest.fn(), downloadReceipt: jest.fn() },
  },
}));

const mockListInvoices = Services.feeInvoices.listFeeInvoices as jest.MockedFunction<
  typeof Services.feeInvoices.listFeeInvoices
>;
const mockFetchInvoice = Services.feeInvoices.fetchFeeInvoice as jest.MockedFunction<
  typeof Services.feeInvoices.fetchFeeInvoice
>;
const mockListReceipts = Services.receipts.listReceipts as jest.MockedFunction<
  typeof Services.receipts.listReceipts
>;
const mockDownload = Services.receipts.downloadReceipt as jest.MockedFunction<
  typeof Services.receipts.downloadReceipt
>;

const outstanding = portalInvoice();
const paid = portalInvoice({
  id: PAID_INVOICE_ID,
  invoice_no: "INV-0002",
  status: "paid",
  paid_total: "9000.00",
  balance_due: "0.00",
});

describe("PortalFees", () => {
  beforeEach(() => {
    jest.mocked(saveBlob).mockReset();
    mockListInvoices.mockReset();
    mockFetchInvoice.mockReset();
    mockListReceipts.mockReset();
    mockDownload.mockReset();
    mockUseParams.mockReturnValue({ studentId: AYESHA_ID, invoiceId: INVOICE_ID });
    mockListInvoices.mockImplementation((query) =>
      Promise.resolve({ items: query?.outstanding ? [outstanding] : [paid] }),
    );
    mockListReceipts.mockResolvedValue({ items: [portalReceipt()] });
  });

  it("fees shows outstanding and paid with a receipt blob download", async () => {
    const blob = new Blob(["%PDF"], { type: "application/pdf" });
    mockDownload.mockResolvedValue(blob);
    const user = userEvent.setup();

    renderWithProviders(<PortalFees />);

    expect(await screen.findByText("INV-0001")).toBeInTheDocument();
    expect(await screen.findByText("INV-0002")).toBeInTheDocument();
    expect(mockListInvoices).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: AYESHA_ID, outstanding: true }),
    );
    expect(mockListInvoices).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: AYESHA_ID, status: "paid" }),
    );
    // There is no way to pay from the portal.
    expect(screen.queryByRole("button", { name: /pay/i })).not.toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: /Receipt RCP-0001/ }));

    await waitFor(() => {
      expect(saveBlob).toHaveBeenCalledWith(blob, "RCP-0001.pdf");
    });
    expect(mockDownload).toHaveBeenCalledWith(RECEIPT_ID);
  });

  it("says in place when a receipt fails to download", async () => {
    mockDownload.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();

    renderWithProviders(<PortalFees />);
    await user.click(await screen.findByRole("button", { name: /Receipt RCP-0001/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't download the receipt");
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it("shows the empty states when nothing is outstanding or paid", async () => {
    mockListInvoices.mockResolvedValue({ items: [] });

    renderWithProviders(<PortalFees />);

    expect(await screen.findByText("Nothing outstanding")).toBeInTheDocument();
    expect(await screen.findByText("No paid invoices")).toBeInTheDocument();
  });

  it("shows an invoice with its lines, totals and receipts", async () => {
    mockFetchInvoice.mockResolvedValue(paid);

    renderWithProviders(<PortalInvoiceDetail />);

    expect(await screen.findByRole("heading", { name: "Invoice INV-0002" })).toBeInTheDocument();
    const lines = within(screen.getByRole("table", { name: "Invoice lines" }));
    expect(lines.getByText("Tuition")).toBeInTheDocument();
    expect(mockFetchInvoice).toHaveBeenCalledWith(INVOICE_ID);
    expect(await screen.findByRole("button", { name: /Receipt RCP-0001/ })).toBeInTheDocument();
  });

  it("does not show another child's invoice under this child's address", async () => {
    mockFetchInvoice.mockResolvedValue(
      portalInvoice({ student: "ffffffff-ffff-4fff-8fff-ffffffffffff" }),
    );

    renderWithProviders(<PortalInvoiceDetail />);

    expect(await screen.findByText(/couldn't load this invoice/)).toBeInTheDocument();
    expect(screen.queryByText("Tuition")).not.toBeInTheDocument();
  });
});
