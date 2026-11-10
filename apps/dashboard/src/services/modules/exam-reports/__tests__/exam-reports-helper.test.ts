import {
  examReportFilename,
  examRowsOfKind,
  formatExamFigure,
  isExamReportKind,
  isSameExamReport,
  toExamReportQuery,
  toExamReportQueryParams,
} from "../exam-reports-helper";
import { EXAM_ID, OTHER_EXAM_ID } from "@/services/modules/exams/__tests__/exams-fixtures";

import { passFailRow, resultRegisterRow } from "./exam-reports-fixtures";

describe("exam-reports-helper", () => {
  it("knows the six kinds and nothing else", () => {
    expect(isExamReportKind("grade-distribution")).toBe(true);
    expect(isExamReportKind("defaulters")).toBe(false);
  });

  it("builds a report only once a kind about one exam has its exam", () => {
    expect(toExamReportQuery({ kind: "result-register", exam: "" })).toBeNull();
    expect(toExamReportQuery({ kind: "result-register", exam: EXAM_ID })).toEqual({
      kind: "result-register",
      examId: EXAM_ID,
    });
    expect(toExamReportQuery({ kind: "nonsense", exam: EXAM_ID })).toBeNull();
  });

  it("drops the exam for question-bank usage, which is about the banks", () => {
    const query = toExamReportQuery({ kind: "question-bank-usage", exam: EXAM_ID });

    expect(query).toEqual({ kind: "question-bank-usage" });
    expect(query && toExamReportQueryParams(query)).toEqual({ kind: "question-bank-usage" });
  });

  it("tells a re-run of the same report from a different one", () => {
    const report = { kind: "result-register" as const, examId: EXAM_ID };

    expect(isSameExamReport(report, { ...report })).toBe(true);
    expect(isSameExamReport(report, { ...report, examId: OTHER_EXAM_ID })).toBe(false);
    expect(isSameExamReport(report, { ...report, kind: "grade-distribution" })).toBe(false);
  });

  it("keeps only the rows of the report's own kind", () => {
    const rows = [resultRegisterRow(), passFailRow()];

    expect(examRowsOfKind(rows, "pass-fail-analysis")).toEqual([passFailRow()]);
  });

  it("names the file after the report and its format, and formats a figure", () => {
    expect(examReportFilename({ kind: "marks-entry-status", examId: EXAM_ID }, "xlsx")).toBe(
      "exam-report-marks-entry-status.xlsx",
    );
    expect(formatExamFigure(78.5, "en")).toBe("78.5");
    expect(formatExamFigure(89.99, "en")).toBe("89.99");
  });
});
