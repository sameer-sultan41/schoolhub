import {
  buildGenerateInvoicesInput,
  generationCounts,
  isInvoiceCancelable,
  outstandingFilter,
} from "../fee-invoices-helper";

describe("isInvoiceCancelable", () => {
  it.each([
    ["issued", "0.00", true],
    ["draft", "0", true],
    ["partially_paid", "500.00", false],
    ["paid", "1500.00", false],
    ["canceled", "0.00", false],
  ] as const)("a %s invoice with %s paid: %s", (status, paid, expected) => {
    expect(isInvoiceCancelable({ status, paid_total: paid })).toBe(expected);
  });
});

describe("buildGenerateInvoicesInput", () => {
  it("sends the month's first day and no term when billing by month", () => {
    expect(
      buildGenerateInvoicesInput({
        fee_structure: "f1",
        by: "month",
        period_start: "2026-10",
        term: "t1",
      }),
    ).toEqual({ feeStructureId: "f1", periodStart: "2026-10-01", termId: null });
  });

  it("sends the term and no month when billing by term", () => {
    expect(
      buildGenerateInvoicesInput({
        fee_structure: "f1",
        by: "term",
        period_start: "2026-10",
        term: "t1",
      }),
    ).toEqual({ feeStructureId: "f1", periodStart: null, termId: "t1" });
  });
});

describe("generationCounts", () => {
  it("reads the job's issued and skipped counts, zero when absent", () => {
    expect(generationCounts({ issued: 3, skipped: 2, rows: [] })).toEqual({
      issued: 3,
      skipped: 2,
    });
    expect(generationCounts(null)).toEqual({ issued: 0, skipped: 0 });
  });
});

describe("outstandingFilter", () => {
  it("is true only for the toggle's on value", () => {
    expect(outstandingFilter("true")).toBe(true);
    expect(outstandingFilter("")).toBeUndefined();
  });
});
