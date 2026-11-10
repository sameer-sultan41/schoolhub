import { screen } from "@testing-library/react";

import type { FinanceReportGroupBy, FinanceReportRun } from "@/services";
import {
  AGING,
  BUDGET,
  CASHIER_ID,
  COLLECTION_CASHIER,
  COLLECTION_DAY,
  COLLECTION_METHOD,
  EXPENSE,
  GRANT,
  INCOME_VS_EXPENSE,
  LEDGER_INVOICE,
  LEDGER_PAYMENT,
  TRIAL_BALANCE,
  WAIVED_FINE,
} from "@/services/modules/finance-reports/__tests__/finance-reports-fixtures";
import { rowOf } from "@/test-fixtures/list-screen";
import { renderWithProviders } from "@/test-utils";

import { ReportTable } from "../report-table";

const FIRST_PAGE = { pageIndex: 0, pageSize: 10 };

function renderReport(
  report: FinanceReportRun,
  groupBy: FinanceReportGroupBy = "day",
  filtered = false,
) {
  renderWithProviders(
    <ReportTable
      report={report}
      groupBy={groupBy}
      filtered={filtered}
      pagination={FIRST_PAGE}
      onPaginationChange={jest.fn()}
    />,
  );
}

const headers = () =>
  screen.getAllByRole("columnheader").map((header) => header.textContent.trim());

/** Every amount shown is the server's string, formatted for display and never computed. */
describe("ReportTable", () => {
  it("shows the collection by day with the server's total and payment count", () => {
    renderReport({ kind: "collection", rows: [COLLECTION_DAY] });

    expect(screen.getByRole("table", { name: "Collection report" })).toBeInTheDocument();
    expect(headers()).toEqual(["Day", "Total", "Payments"]);
    const row = rowOf("October 1st, 2026");
    expect(row.getByText("1,500.00")).toBeInTheDocument();
    expect(row.getByText("3")).toBeInTheDocument();
  });

  it("shows the collection by payment method", () => {
    renderReport({ kind: "collection", rows: [COLLECTION_METHOD] }, "method");

    expect(headers()).toEqual(["Payment method", "Total", "Payments"]);
    const row = rowOf("Bank transfer");
    expect(row.getByText("900.50")).toBeInTheDocument();
    expect(row.getByText("2")).toBeInTheDocument();
  });

  it("shows the collection by cashier, with the register's totals per cashier", () => {
    renderReport(
      {
        kind: "collection",
        rows: [COLLECTION_CASHIER, { ...COLLECTION_CASHIER, received_by: null, total: "10.00" }],
      },
      "cashier",
    );

    expect(headers()).toEqual(["Cashier", "Total", "Payments"]);
    const row = rowOf(CASHIER_ID.slice(0, 8));
    expect(row.getByText("2,400.50")).toBeInTheDocument();
    expect(row.getByText("5")).toBeInTheDocument();
    expect(rowOf("Online or system").getByText("10.00")).toBeInTheDocument();
  });

  it("shows each student's balance split into the server's aging buckets", () => {
    renderReport({ kind: "outstanding-aging", rows: [AGING] });

    expect(headers()).toEqual([
      "Student",
      "Outstanding",
      "Invoices",
      "Not yet due",
      "0-30 days",
      "31-60 days",
      "61-90 days",
      "Over 90 days",
    ]);
    const row = rowOf("Aisha Khan");
    expect(row.getByText("ADM-1001")).toBeInTheDocument();
    expect(row.getByText("4,000.00")).toBeInTheDocument();
    expect(row.getByText("4")).toBeInTheDocument();
    expect(row.getByText("1,000.00")).toBeInTheDocument();
    expect(row.getAllByText("500.00")).toHaveLength(2);
    expect(row.getByText("750.25")).toBeInTheDocument();
    expect(row.getByText("1,249.75")).toBeInTheDocument();
  });

  it("shows a statement's lines with the server's running balance", () => {
    renderReport({ kind: "student-ledger", rows: [LEDGER_INVOICE, LEDGER_PAYMENT] });

    expect(headers()).toEqual([
      "Date",
      "Type",
      "Reference",
      "Description",
      "Debit",
      "Credit",
      "Balance",
    ]);
    const invoice = rowOf("INV-0001");
    expect(invoice.getByText("Invoice")).toBeInTheDocument();
    expect(invoice.getByText("August 1st, 2026")).toBeInTheDocument();
    expect(invoice.getByText("2026-09")).toBeInTheDocument();
    expect(invoice.getAllByText("1,000.00")).toHaveLength(2);
    const payment = rowOf("RCP-0007");
    expect(payment.getByText("Payment")).toBeInTheDocument();
    expect(payment.getByText("Cash")).toBeInTheDocument();
    expect(payment.getByText("400.00")).toBeInTheDocument();
    expect(payment.getByText("600.00")).toBeInTheDocument();
  });

  it("labels a filtered statement's running balance as covering only the filtered lines", () => {
    renderReport({ kind: "student-ledger", rows: [LEDGER_PAYMENT] }, "day", true);

    expect(headers()).toContain("Balance (within filters)");
    expect(headers()).not.toContain("Balance");
    // The figure itself is still the server's.
    expect(rowOf("RCP-0007").getByText("600.00")).toBeInTheDocument();
  });

  it("shows a grant and a waived fine each as its own type, with its source's status", () => {
    renderReport({ kind: "grant-register", rows: [GRANT, WAIVED_FINE] });

    expect(headers()).toEqual([
      "Grant",
      "Name",
      "Admission no.",
      "Value",
      "Status",
      "Approved by",
      "Granted on",
    ]);
    const grant = rowOf("Merit award");
    expect(grant.getByText("Scholarship")).toBeInTheDocument();
    expect(grant.getByText("25.00 (Percent)")).toBeInTheDocument();
    expect(grant.getByText("Active")).toBeInTheDocument();
    expect(grant.getByText(CASHIER_ID.slice(0, 8))).toBeInTheDocument();
    const fine = rowOf("library");
    expect(fine.getByText("Fine waiver")).toBeInTheDocument();
    expect(fine.getByText("250.00 (Fixed amount)")).toBeInTheDocument();
    expect(fine.getByText("Waived")).toBeInTheDocument();
  });

  it("shows income against expense with the server's net", () => {
    renderReport({ kind: "income-vs-expense", rows: [INCOME_VS_EXPENSE] });

    expect(headers()).toEqual([
      "Code",
      "Name",
      "Account type",
      "Total debit",
      "Total credit",
      "Net",
    ]);
    const row = rowOf("Fee income");
    expect(row.getByText("4000")).toBeInTheDocument();
    expect(row.getByText("Income")).toBeInTheDocument();
    expect(row.getByText("0.00")).toBeInTheDocument();
    expect(row.getAllByText("50,000.00")).toHaveLength(2);
  });

  it("shows a budget's variance and utilisation as the server computed them", () => {
    renderReport({ kind: "budget-variance", rows: [BUDGET] });

    expect(headers()).toEqual(["Budget", "Period", "Budgeted", "Actual", "Variance", "Used"]);
    const row = rowOf("Utilities Q4");
    expect(row.getByText("October 1st, 2026 to December 31st, 2026")).toBeInTheDocument();
    expect(row.getByText("100,000.00")).toBeInTheDocument();
    expect(row.getByText("62,500.00")).toBeInTheDocument();
    expect(row.getByText("37,500.00")).toBeInTheDocument();
    expect(row.getByText("62.50%")).toBeInTheDocument();
  });

  it("shows an expense with its category, status and a dash for no campus", () => {
    renderReport({ kind: "expense-register", rows: [EXPENSE] });

    expect(headers()).toEqual([
      "Expense no.",
      "Date",
      "Category",
      "Vendor",
      "Description",
      "Campus",
      "Amount",
      "Tax",
      "Status",
      "Approved by",
    ]);
    const row = rowOf("EXP-0001");
    expect(row.getByText("October 5th, 2026")).toBeInTheDocument();
    expect(row.getByText("Utilities")).toBeInTheDocument();
    expect(row.getByText("UTIL")).toBeInTheDocument();
    expect(row.getByText("City Power")).toBeInTheDocument();
    expect(row.getByText("Electricity bill")).toBeInTheDocument();
    expect(row.getByText("—")).toBeInTheDocument();
    expect(row.getByText("5,000.00")).toBeInTheDocument();
    expect(row.getByText("250.00")).toBeInTheDocument();
    expect(row.getByText("Approved")).toBeInTheDocument();
  });

  it("shows the trial balance with a negative balance as the server sent it", () => {
    renderReport({ kind: "trial-balance", rows: [TRIAL_BALANCE] });

    expect(headers()).toEqual([
      "Code",
      "Name",
      "Account type",
      "Total debit",
      "Total credit",
      "Balance",
    ]);
    const row = rowOf("Fee income");
    expect(row.getByText("100.00")).toBeInTheDocument();
    expect(row.getByText("50,100.00")).toBeInTheDocument();
    expect(row.getByText("-50,000.00")).toBeInTheDocument();
  });

  it("says so when a report has no rows", () => {
    renderReport({ kind: "grant-register", rows: [] });

    expect(screen.getByText("No rows")).toBeInTheDocument();
    expect(screen.getByText("No rows match these dates and filters.")).toBeInTheDocument();
  });
});
