import {
  formatOneDecimal,
  isReportKind,
  jobResultFileId,
  jobResultMode,
  isSameReport,
  reportFilename,
  rowsOfKind,
  toReportQuery,
} from "../attendance-reports-helper";
import { isValidThreshold } from "../attendance-reports.schema";
import type { ReportFormValues } from "../attendance-reports-type";
import {
  dailyRegisterRow,
  defaulterRow,
  leaveRow,
  PERIOD_ID,
  SECTION_ID,
  summaryRow,
} from "./attendance-reports-fixtures";

const TODAY = "2026-10-24";

function values(overrides: Partial<ReportFormValues> = {}): ReportFormValues {
  return {
    kind: "student-summary",
    from: "",
    to: "",
    sectionId: "",
    periodId: "",
    threshold: "75",
    ...overrides,
  };
}

describe("attendance-reports-helper", () => {
  it("knows the six kinds and nothing else", () => {
    expect(isReportKind("defaulters")).toBe(true);
    expect(isReportKind("staff-punctuality")).toBe(true);
    expect(isReportKind("summary")).toBe(false);
  });

  it("opens a range report on the last 30 days, today included", () => {
    expect(toReportQuery(values(), TODAY)).toEqual({
      kind: "student-summary",
      startDate: "2026-09-25",
      endDate: TODAY,
      sectionId: undefined,
      periodId: undefined,
      threshold: undefined,
    });
  });

  it("sends the daily register one date, today unless picked, with its section and period", () => {
    expect(
      toReportQuery(
        values({ kind: "daily-register", sectionId: SECTION_ID, periodId: PERIOD_ID }),
        TODAY,
      ),
    ).toEqual({
      kind: "daily-register",
      startDate: TODAY,
      endDate: undefined,
      sectionId: SECTION_ID,
      periodId: PERIOD_ID,
      threshold: undefined,
    });
  });

  it("drops a period without a section, and inputs the kind does not take", () => {
    expect(
      toReportQuery(values({ kind: "daily-register", periodId: PERIOD_ID }), TODAY)?.periodId,
    ).toBeUndefined();
    const leave = toReportQuery(
      values({ kind: "leave", sectionId: SECTION_ID, threshold: "90" }),
      TODAY,
    );
    expect(leave?.sectionId).toBeUndefined();
    expect(leave?.threshold).toBeUndefined();
  });

  it("sends the defaulters' threshold, and can't run with one the API would refuse", () => {
    expect(toReportQuery(values({ kind: "defaulters", threshold: "90" }), TODAY)?.threshold).toBe(
      "90",
    );
    expect(toReportQuery(values({ kind: "defaulters", threshold: "100.5" }), TODAY)).toBeNull();
    expect(toReportQuery(values({ kind: "defaulters", threshold: "" }), TODAY)).toBeNull();
  });

  it("can't run a range that ends before it starts", () => {
    expect(toReportQuery(values({ from: "2026-10-10", to: "2026-10-09" }), TODAY)).toBeNull();
  });

  it.each([
    ["0", true],
    ["75", true],
    ["99.5", true],
    ["100", true],
    ["100.1", false],
    ["-1", false],
    ["75.25", false],
    ["abc", false],
  ])("checks the threshold %s as the API does", (threshold, valid) => {
    expect(isValidThreshold(threshold)).toBe(valid);
  });

  it("narrows rows on their kind", () => {
    const rows = [dailyRegisterRow(), summaryRow(), defaulterRow(), leaveRow()];

    expect(rowsOfKind(rows, "defaulters")).toEqual([defaulterRow()]);
    expect(rowsOfKind(rows, "leave")).toEqual([leaveRow()]);
    expect(rowsOfKind(rows, "staff-punctuality")).toEqual([]);
  });

  it("formats a rate to exactly one decimal place", () => {
    expect(formatOneDecimal(40, "en")).toBe("40.0");
    expect(formatOneDecimal(16.666666666666668, "en")).toBe("16.7");
  });

  it("reads a finished job's file and mode, and nothing from a result without them", () => {
    const result = {
      result_file_id: "file-1",
      rows: 1200,
      format: "csv",
      attendance_mode: "period",
    };

    expect(jobResultFileId(result)).toBe("file-1");
    expect(jobResultMode(result)).toBe("period");
    expect(jobResultMode({ ...result, attendance_mode: "daily" })).toBe("daily");
    expect(jobResultFileId(null)).toBeNull();
    expect(jobResultMode({ result_file_id: "file-1" })).toBeNull();
  });

  it("tells a re-run of the same report from a different one", () => {
    const report = { kind: "defaulters" as const, startDate: "2026-10-01", threshold: "90" };

    expect(isSameReport(report, { ...report })).toBe(true);
    expect(isSameReport(report, { ...report, threshold: "80" })).toBe(false);
  });

  it("names the file after the report, its start and its format", () => {
    expect(reportFilename({ kind: "leave", startDate: "2026-10-01" }, "pdf")).toBe(
      "attendance-report-leave-2026-10-01.pdf",
    );
  });
});
