import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { renderWithProviders, setUrl } from "@/test-utils";

import { InvoicesHome } from "@/features/fees/invoices/invoices-home";
import {
  asUser,
  cursorPage,
  INVOICE_ID,
  invoiceRecord,
  listFeeInvoices,
  rowOf,
  stubFeesServices,
  urlParam,
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

const SECOND_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function renderHome() {
  renderWithProviders(
    <>
      <UserLoaded />
      <InvoicesHome />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

describe("invoices list", () => {
  beforeEach(() => {
    stubFeesServices("/fees/invoices");
  });

  it("shows each amount exactly as the server sent it, with a link to the invoice", async () => {
    listFeeInvoices.mockResolvedValue(
      cursorPage([
        invoiceRecord({ balance_due: "1350.00" }),
        invoiceRecord({
          id: SECOND_ID,
          invoice_no: "INV-2026-0002",
          student_name: "Bilal Ahmed",
          fee_structure: null,
          period_label: null,
          status: "paid",
          paid_total: "900.5",
          balance_due: "0",
        }),
      ]),
    );
    asUser("fees.invoice.view", "fees.fee-structure.view");
    await renderHome();

    await screen.findByText("INV-2026-0002");
    const first = rowOf("INV-2026-0001");
    expect(first.getByText("1,350.00")).toBeInTheDocument();
    expect(await first.findByText("Grade 1 fees")).toBeInTheDocument();
    expect(first.getByText("Ayesha Khan")).toBeInTheDocument();
    expect(first.getByText("Issued")).toBeInTheDocument();
    expect(first.getByRole("link", { name: "INV-2026-0001" })).toHaveAttribute(
      "href",
      `/fees/invoices/${INVOICE_ID}`,
    );
    const second = rowOf("INV-2026-0002");
    expect(second.getByText("0.00")).toBeInTheDocument();
    expect(second.getByText("Ad hoc")).toBeInTheDocument();
    expect(second.getByText("Paid")).toBeInTheDocument();
  });

  it("offers no Generate or New invoice to a viewer holding only the view key", async () => {
    asUser("fees.invoice.view");
    await renderHome();

    await screen.findByText("INV-2026-0001");
    expect(screen.queryByRole("button", { name: "Generate invoices" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New invoice" })).not.toBeInTheDocument();
  });

  it("offers Generate and New invoice to a holder of the create key", async () => {
    asUser("fees.invoice.view", "fees.invoice.create");
    await renderHome();

    expect(await screen.findByRole("button", { name: "Generate invoices" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New invoice" })).toBeInTheDocument();
  });

  it("does not read the structure or session lists without their keys", async () => {
    asUser("fees.invoice.view");
    await renderHome();

    await screen.findByText("INV-2026-0001");
    expect(screen.queryByRole("combobox", { name: "Structure" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Session" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status" })).toBeInTheDocument();
  });

  it("writes outstanding=true to the URL and the read when Defaulters is switched on", async () => {
    asUser("fees.invoice.view");
    const user = await renderHome();
    await screen.findByText("INV-2026-0001");
    expect(urlParam("outstanding")).toBeNull();
    expect(listFeeInvoices).toHaveBeenLastCalledWith(
      expect.objectContaining({ outstanding: undefined }),
    );

    await user.click(screen.getByRole("switch", { name: "Defaulters only" }));

    await waitFor(() => {
      expect(urlParam("outstanding")).toBe("true");
    });
    await waitFor(() => {
      expect(listFeeInvoices).toHaveBeenLastCalledWith(
        expect.objectContaining({ outstanding: true }),
      );
    });

    await user.click(screen.getByRole("switch", { name: "Defaulters only" }));
    await waitFor(() => {
      expect(urlParam("outstanding")).toBeNull();
    });
  });

  it("starts with Defaulters on when the URL says so", async () => {
    setUrl("/fees/invoices?outstanding=true");
    asUser("fees.invoice.view");
    await renderHome();

    await screen.findByText("INV-2026-0001");
    expect(screen.getByRole("switch", { name: "Defaulters only" })).toBeChecked();
    expect(listFeeInvoices).toHaveBeenCalledWith(expect.objectContaining({ outstanding: true }));
  });

  it("filters by status through the URL", async () => {
    asUser("fees.invoice.view");
    const user = await renderHome();
    await screen.findByText("INV-2026-0001");

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Overdue" }));

    await waitFor(() => {
      expect(urlParam("status")).toBe("overdue");
    });
    expect(listFeeInvoices).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "overdue" }),
    );
  });
});
