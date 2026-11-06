import { screen } from "@testing-library/react";

import type { ExamInlineReport } from "@/services";
import {
  gradeDistributionRow,
  marksEntryStatusRow,
  passFailRow,
  questionBankUsageRow,
  resultRegisterRow,
  subjectPerformanceRow,
  ungradedRow,
} from "@/services/modules/exam-reports/__tests__/exam-reports-fixtures";
import { rowOf } from "@/test-fixtures/list-screen";
import { renderWithProviders } from "@/test-utils";

import { ExamReportTable } from "../exam-report-table";

const FIRST_PAGE = { pageIndex: 0, pageSize: 10 };

function renderReport(report: ExamInlineReport) {
  renderWithProviders(
    <ExamReportTable report={report} pagination={FIRST_PAGE} onPaginationChange={jest.fn()} />,
  );
}

const headers = () =>
  screen.getAllByRole("columnheader").map((header) => header.textContent.trim());

describe("ExamReportTable", () => {
  it("shows the result register by student, with marks, grade, outcome and status", () => {
    renderReport({ kind: "result-register", rows: [resultRegisterRow()] });

    expect(screen.getByRole("table", { name: "Result register report" })).toBeInTheDocument();
    expect(headers()).toEqual([
      "Rank",
      "Student",
      "Section",
      "Percentage",
      "Marks",
      "Grade",
      "GPA",
      "Class rank",
      "Outcome",
      "Status",
    ]);
    const row = rowOf("Ayesha Khan");
    expect(row.getByText("ADM-001")).toBeInTheDocument();
    expect(row.getByText("78.5%")).toBeInTheDocument();
    expect(row.getByText("314 / 400")).toBeInTheDocument();
    expect(row.getByText("Pass")).toBeInTheDocument();
    expect(row.getByText("Published")).toBeInTheDocument();
  });

  it("shows an unranked, ungraded result with dashes", () => {
    renderReport({
      kind: "result-register",
      rows: [
        resultRegisterRow({ rank_in_section: null, rank_in_class: null, grade: null, gpa: null }),
      ],
    });

    expect(rowOf("Ayesha Khan").getAllByText("—")).toHaveLength(4);
  });

  it("shows the pass/fail analysis per section, its rate and figures as percentages", () => {
    renderReport({ kind: "pass-fail-analysis", rows: [passFailRow()] });

    expect(headers()).toEqual([
      "Section",
      "Students",
      "Sat",
      "Passed",
      "Failed",
      "Absent",
      "Withheld",
      "Average",
      "Highest",
      "Lowest",
      "Pass rate",
    ]);
    const row = rowOf("7-A");
    expect(row.getByText("71.25%")).toBeInTheDocument();
    expect(row.getByText("89.3%")).toBeInTheDocument();
  });

  it("shows subject performance per exam-subject, a dash for no lowest mark", () => {
    renderReport({ kind: "subject-performance", rows: [subjectPerformanceRow()] });

    expect(headers()).toEqual([
      "Subject",
      "Class",
      "Max marks",
      "Pass marks",
      "Students",
      "Average",
      "Highest",
      "Lowest",
      "Passed",
      "Pass rate",
    ]);
    const row = rowOf("Mathematics");
    expect(row.getByText("64.5")).toBeInTheDocument();
    expect(row.getByText("—")).toBeInTheDocument();
    expect(row.getByText("85.7%")).toBeInTheDocument();
  });

  it("shows marks-entry status per exam-subject, a dash while unlocked", () => {
    renderReport({ kind: "marks-entry-status", rows: [marksEntryStatusRow()] });

    expect(headers()).toEqual([
      "Subject",
      "Class",
      "Entered",
      "Draft",
      "Submitted",
      "Locked rows",
      "Absent",
      "Exempt",
      "Locked",
    ]);
    expect(rowOf("Science").getByText("—")).toBeInTheDocument();
  });

  it("shows the grade distribution per band, the ungraded last", () => {
    renderReport({ kind: "grade-distribution", rows: [gradeDistributionRow(), ungradedRow()] });

    expect(headers()).toEqual(["Grade", "Range", "Passing band", "Students"]);
    expect(rowOf("A").getByText("80–89.99%")).toBeInTheDocument();
    expect(rowOf("A").getByText("Passing")).toBeInTheDocument();
    expect(rowOf("Ungraded").getAllByText("—")).toHaveLength(2);
  });

  it("shows question-bank usage per bank and difficulty", () => {
    renderReport({ kind: "question-bank-usage", rows: [questionBankUsageRow()] });

    expect(headers()).toEqual([
      "Question bank",
      "Subject",
      "Difficulty",
      "Questions",
      "Approved",
      "Used in a paper",
      "Average uses",
    ]);
    const row = rowOf("Algebra I");
    expect(row.getByText("Hard")).toBeInTheDocument();
    expect(row.getByText("1.5")).toBeInTheDocument();
  });

  it("renders only the rows of the report's own kind, and says when there are none", () => {
    renderReport({ kind: "pass-fail-analysis", rows: [resultRegisterRow()] });

    expect(screen.queryByText("Ayesha Khan")).not.toBeInTheDocument();
    expect(screen.getByText("No rows")).toBeInTheDocument();
    expect(screen.getByText("0 rows")).toBeInTheDocument();
  });
});
