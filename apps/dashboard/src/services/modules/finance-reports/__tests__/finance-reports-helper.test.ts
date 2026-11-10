import { ApiError } from "@schoolhub/api-client";

import { DEFAULT_FINANCE_REPORT_GROUPING } from "../finance-reports-constant";
import {
  effectiveFinanceReportDates,
  financeReportFilename,
  financeReportRowLimit,
  financeRowsOfKind,
  readClosingBalance,
  toFinanceReportParams,
  toFinanceReportQuery,
} from "../finance-reports-helper";
import type { FinanceReportFormValues } from "../finance-reports-type";
import { COLLECTION_DAY, LEDGER_INVOICE, STUDENT_ID } from "./finance-reports-fixtures";

const TODAY = "2026-10-15";
const SESSION_ID = "99999999-9999-4999-8999-999999999999";

const form = (overrides: Partial<FinanceReportFormValues> = {}): FinanceReportFormValues => ({
  kind: "collection",
  from: "",
  to: "",
  student: "",
  group: DEFAULT_FINANCE_REPORT_GROUPING,
  campus: "",
  session: "",
  class: "",
  ...overrides,
});

describe("effectiveFinanceReportDates", () => {
  it("opens the collection on today", () => {
    expect(effectiveFinanceReportDates(form(), TODAY)).toEqual({ from: TODAY, to: TODAY });
  });

  it("opens the other range reports on the last 30 days, today included", () => {
    expect(effectiveFinanceReportDates(form({ kind: "trial-balance" }), TODAY)).toEqual({
      from: "2026-09-16",
      to: TODAY,
    });
  });

  it("keeps the dates the URL names", () => {
    expect(
      effectiveFinanceReportDates(form({ from: "2026-10-01", to: "2026-10-09" }), TODAY),
    ).toEqual({ from: "2026-10-01", to: "2026-10-09" });
  });

  it("reads a one-date kind's date from `to`, the one the server uses", () => {
    expect(
      effectiveFinanceReportDates(form({ kind: "outstanding-aging", to: "2026-09-30" }), TODAY),
    ).toEqual({ from: "2026-09-30", to: "2026-09-30" });
  });

  it("sends today for a kind with no dates", () => {
    expect(
      effectiveFinanceReportDates(form({ kind: "grant-register", from: "2020-01-01" }), TODAY),
    ).toEqual({ from: TODAY, to: TODAY });
  });
});

describe("toFinanceReportQuery", () => {
  it("keeps only the inputs the kind takes", () => {
    const query = toFinanceReportQuery(
      form({
        kind: "expense-register",
        campus: SESSION_ID,
        session: SESSION_ID,
        class: SESSION_ID,
      }),
      TODAY,
    );

    expect(query).toEqual({
      kind: "expense-register",
      dateFrom: "2026-09-16",
      dateTo: TODAY,
      campusId: SESSION_ID,
      studentId: undefined,
      groupBy: undefined,
      academicSessionId: undefined,
      classId: undefined,
    });
  });

  it("groups only the collection", () => {
    expect(toFinanceReportQuery(form({ group: "cashier" }), TODAY)?.groupBy).toBe("cashier");
    expect(
      toFinanceReportQuery(form({ kind: "outstanding-aging", group: "cashier" }), TODAY)?.groupBy,
    ).toBeUndefined();
  });

  it("cannot run a statement without its student", () => {
    expect(toFinanceReportQuery(form({ kind: "student-ledger" }), TODAY)).toBeNull();
    expect(
      toFinanceReportQuery(form({ kind: "student-ledger", student: STUDENT_ID }), TODAY)?.studentId,
    ).toBe(STUDENT_ID);
  });

  it("cannot run a range that ends before it starts, or an unknown kind", () => {
    expect(toFinanceReportQuery(form({ from: "2026-10-09", to: "2026-10-01" }), TODAY)).toBeNull();
    expect(toFinanceReportQuery(form({ kind: "nope" }), TODAY)).toBeNull();
  });
});

describe("toFinanceReportParams", () => {
  it("names the API's parameters and leaves out what is unset", () => {
    const query = toFinanceReportQuery(
      form({ kind: "grant-register", campus: SESSION_ID, class: SESSION_ID }),
      TODAY,
    );
    expect(query).not.toBeNull();
    if (!query) return;

    expect(toFinanceReportParams(query)).toEqual({
      kind: "grant-register",
      date_from: TODAY,
      date_to: TODAY,
      campus_id: SESSION_ID,
      class_id: SESSION_ID,
    });
  });
});

describe("financeRowsOfKind", () => {
  it("narrows on the discriminator", () => {
    expect(financeRowsOfKind([COLLECTION_DAY, LEDGER_INVOICE], "student-ledger")).toEqual([
      LEDGER_INVOICE,
    ]);
  });
});

describe("financeReportRowLimit", () => {
  const refusal = (status: number, meta: Record<string, unknown>) =>
    new ApiError({
      code: "domain_rule_violation",
      message: "Too large",
      status,
      url: "/reports/finance-summary",
      meta,
    });

  it("reads the ceiling off the 422 a too-large report answers with", () => {
    expect(financeReportRowLimit(refusal(422, { row_limit: 1000 }))).toBe(1000);
  });

  it("is null for any other failure, so it still shows as an error", () => {
    expect(financeReportRowLimit(refusal(422, {}))).toBeNull();
    expect(financeReportRowLimit(refusal(400, { row_limit: 1000 }))).toBeNull();
    expect(financeReportRowLimit(new Error("boom"))).toBeNull();
  });
});

describe("financeReportFilename", () => {
  it("names the kind, the end date and the format", () => {
    const query = toFinanceReportQuery(form(), TODAY);
    expect(query).not.toBeNull();
    if (!query) return;
    expect(financeReportFilename(query, "xlsx")).toBe("fees-report-collection-2026-10-15.xlsx");
  });
});

describe("readClosingBalance", () => {
  it("returns the server's string untouched, zero included", () => {
    expect(readClosingBalance({ row_count: 0, closing_balance: "0.00" })).toBe("0.00");
    expect(readClosingBalance({ closing_balance: "-250.00" })).toBe("-250.00");
  });

  it("throws rather than invent a balance when the server sent none", () => {
    expect(() => readClosingBalance(undefined)).toThrow("closing_balance");
    expect(() => readClosingBalance({ closing_balance: 600 })).toThrow("closing_balance");
  });
});
