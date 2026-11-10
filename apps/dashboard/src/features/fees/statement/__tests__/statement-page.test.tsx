import { screen, within } from "@testing-library/react";

import { ApiError } from "@schoolhub/api-client";
import type { PermissionKey } from "@schoolhub/types";
import { Services } from "@/services";
import {
  STATEMENT_INVOICE,
  STATEMENT_PAYMENT,
  STUDENT_ID,
} from "@/services/modules/finance-reports/__tests__/finance-reports-fixtures";
import { mocked } from "@/test-fixtures/list-screen";
import { studentRecord } from "@/test-fixtures/communication";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { StatementPage } from "../statement-page";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("@/services", () =>
  jest
    .requireActual<{ reportsServicesMock: () => unknown }>(
      "@/features/fees/reports/__tests__/reports-services-mock",
    )
    .reportsServicesMock(),
);

const fetchStatement = mocked(Services.financeReports.fetchStudentStatement);
const fetchStudent = mocked(Services.students.fetchStudentById);

function asUser(...keys: PermissionKey[]) {
  mocked(Services.auth.fetchCurrentUser).mockResolvedValue(buildUser(keys));
}

async function renderStatement() {
  renderWithProviders(
    <>
      <UserLoaded />
      <StatementPage studentId={STUDENT_ID} />
    </>,
  );
  await screen.findByText(USER_LOADED);
}

describe("student statement page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setUrl(`/fees/students/${STUDENT_ID}/ledger`);
    fetchStudent.mockResolvedValue(studentRecord());
    fetchStatement.mockResolvedValue({
      entries: [STATEMENT_INVOICE, STATEMENT_PAYMENT],
      // Deliberately not the last line's balance (600.00): the screen shows what it was sent.
      closingBalance: "612.50",
    });
  });

  it("shows the server's lines, running balances and closing balance exactly", async () => {
    asUser("fees.invoice.view", "students.student.view");
    await renderStatement();

    const table = await screen.findByRole("table", { name: /Statement/ });
    const rows = within(table).getAllByRole("row");
    // Header + the two lines, in the server's order.
    expect(rows).toHaveLength(3);
    const invoice = within(rows[1]);
    for (const text of ["Invoice", "INV-0001", "2026-09", "1,000.00"]) {
      expect(invoice.getAllByText(text).length).toBeGreaterThan(0);
    }
    const payment = within(rows[2]);
    for (const text of ["Payment", "RCP-0007", "400.00", "600.00"]) {
      expect(payment.getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("Closing balance").parentElement).toHaveTextContent("612.50");
    expect(fetchStatement).toHaveBeenCalledWith(STUDENT_ID);
  });

  it("names the student for a holder of the student read key", async () => {
    asUser("fees.invoice.view", "students.student.view");
    await renderStatement();

    expect(await screen.findByText("Statement for Ayesha Khan")).toBeInTheDocument();
  });

  it("keeps a generic heading, and never reads the student, without the student read key", async () => {
    asUser("fees.invoice.view");
    await renderStatement();

    expect(await screen.findByText("Student statement")).toBeInTheDocument();
    expect(await screen.findByText("Closing balance")).toBeInTheDocument();
    expect(fetchStudent).not.toHaveBeenCalled();
  });

  it("says so, with a way back, when the student is not found", async () => {
    fetchStatement.mockRejectedValue(
      new ApiError({
        status: 404,
        code: "not_found",
        message: "Not found.",
        url: `/students/${STUDENT_ID}/ledger`,
      }),
    );
    asUser("fees.invoice.view");
    await renderStatement();

    expect(await screen.findByText("Student not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to invoices" })).toHaveAttribute(
      "href",
      "/fees/invoices",
    );
  });

  it("shows the load-error state, with a retry, when the response carries no closing balance", async () => {
    // The service throws on a contract break (no `closing_balance`); the query turns it into the
    // page's error state rather than a crash or an invented zero.
    fetchStatement.mockRejectedValue(
      new Error("The student statement response carried no closing_balance."),
    );
    asUser("fees.invoice.view");
    await renderStatement();

    expect(await screen.findByText("The statement could not be loaded.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("Closing balance")).not.toBeInTheDocument();
  });

  it("does not fetch the statement without the invoice view key", async () => {
    asUser("students.student.view");
    await renderStatement();

    expect(await screen.findByText("The statement isn't available to you")).toBeInTheDocument();
    expect(fetchStatement).not.toHaveBeenCalled();
  });
});
