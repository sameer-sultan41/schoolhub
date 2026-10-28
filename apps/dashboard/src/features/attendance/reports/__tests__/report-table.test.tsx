import { screen } from "@testing-library/react";

import type { AttendanceReportRow, InlineReport } from "@/services";
import {
  dailyRegisterRow,
  defaulterRow,
  lateArrivalsRow,
  leaveRow,
  staffPunctualityRow,
  summaryRow,
} from "@/services/modules/attendance-reports/__tests__/attendance-reports-fixtures";
import { rowOf } from "@/test-fixtures/list-screen";
import { renderWithProviders } from "@/test-utils";

import { ReportTable } from "../report-table";

const FIRST_PAGE = { pageIndex: 0, pageSize: 10 };

/** The table ignores the mode; the reports carry the daily default. */
function renderReport(report: Omit<InlineReport, "attendanceMode">) {
  renderWithProviders(
    <ReportTable
      report={{ ...report, attendanceMode: "daily" }}
      pagination={FIRST_PAGE}
      onPaginationChange={jest.fn()}
    />,
  );
}

const headers = () =>
  screen.getAllByRole("columnheader").map((header) => header.textContent.trim());

describe("ReportTable", () => {
  it("shows a daily register's status, check-in and remarks, and a dash for no period", () => {
    renderReport({ kind: "daily-register", rows: [dailyRegisterRow()] });

    expect(screen.getByRole("table", { name: "Daily register report" })).toBeInTheDocument();
    expect(headers()).toEqual([
      "Student",
      "Section",
      "Period",
      "Status",
      "Check-in",
      "Late (min)",
      "Remarks",
    ]);
    const row = rowOf("Ayesha Khan");
    expect(row.getByText("ADM-001")).toBeInTheDocument();
    expect(row.getByText("Late")).toBeInTheDocument();
    expect(row.getByText("08:40")).toBeInTheDocument();
    expect(row.getByText("40")).toBeInTheDocument();
    expect(row.getByText("Bus delayed")).toBeInTheDocument();
    expect(row.getByText("—")).toBeInTheDocument();
  });

  it("names the period when the register lists one period's rows", () => {
    renderReport({
      kind: "daily-register",
      rows: [dailyRegisterRow({ period_name: "Period 2", remarks: null, late_minutes: 5 })],
    });

    expect(rowOf("Ayesha Khan").getByText("Period 2")).toBeInTheDocument();
  });

  it.each([
    ["student-summary", "Student summary report", summaryRow(), "80.0%"],
    ["defaulters", "Defaulters report", defaulterRow(), "40.0%"],
  ] as const)("shows %s day counts and the rate to one decimal", (kind, caption, row, rate) => {
    renderReport({ kind, rows: [row] });

    expect(screen.getByRole("table", { name: caption })).toBeInTheDocument();
    expect(headers()).toEqual([
      "Student",
      "Present",
      "Absent",
      "Late",
      "Leave",
      "Counted days",
      "Rate",
    ]);
    expect(rowOf("Ayesha Khan").getByText(rate)).toBeInTheDocument();
  });

  it("rounds a fractional rate to one decimal place", () => {
    renderReport({ kind: "defaulters", rows: [defaulterRow({ attendance_rate: 66.7 })] });

    expect(rowOf("Ayesha Khan").getByText("66.7%")).toBeInTheDocument();
  });

  it("shows late arrivals' counts and the average to one decimal", () => {
    renderReport({ kind: "student-late-arrivals", rows: [lateArrivalsRow()] });

    expect(headers()).toEqual(["Student", "Late days", "Total late (min)", "Average late (min)"]);
    const row = rowOf("Ayesha Khan");
    expect(row.getByText("50")).toBeInTheDocument();
    expect(row.getByText("16.7")).toBeInTheDocument();
  });

  it("shows staff punctuality by staff member, a dash for no early departures", () => {
    renderReport({ kind: "staff-punctuality", rows: [staffPunctualityRow()] });

    expect(headers()).toEqual([
      "Staff member",
      "Working days",
      "Present",
      "Absent",
      "Leave",
      "Late days",
      "Total late (min)",
      "Left early (min)",
    ]);
    const row = rowOf("Omar Farooq");
    expect(row.getByText("EMP-002")).toBeInTheDocument();
    expect(row.getByText("20")).toBeInTheDocument();
    expect(row.getByText("—")).toBeInTheDocument();
  });

  it("shows leave requests with their type, dates, days, day part and status", () => {
    renderReport({ kind: "leave", rows: [leaveRow()] });

    expect(headers()).toEqual(["Student", "Leave type", "Dates", "Days", "Day part", "Status"]);
    const row = rowOf("Ayesha Khan");
    expect(row.getByText("Sick leave")).toBeInTheDocument();
    expect(row.getByText("October 12th, 2026 to October 13th, 2026")).toBeInTheDocument();
    expect(row.getByText("1.5")).toBeInTheDocument();
    expect(row.getByText("Full day")).toBeInTheDocument();
    expect(row.getByText("Approved")).toBeInTheDocument();
  });

  it("renders only the rows of the report's own kind", () => {
    const rows: AttendanceReportRow[] = [
      defaulterRow(),
      staffPunctualityRow({ first_name: "Stray", last_name: "Row" }),
    ];
    renderReport({ kind: "defaulters", rows });

    expect(screen.getByText("Ayesha Khan")).toBeInTheDocument();
    expect(screen.queryByText("Stray Row")).not.toBeInTheDocument();
  });

  it("counts the rows and says when there are none", () => {
    renderReport({ kind: "leave", rows: [] });

    expect(screen.getByText("0 rows")).toBeInTheDocument();
    expect(
      screen.getByText("Nothing matches this report's dates and filters."),
    ).toBeInTheDocument();
  });

  it("pages a long report in the browser", () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      summaryRow({ student_id: `id-${String(index)}`, first_name: `Student${String(index)}` }),
    );
    renderReport({ kind: "student-summary", rows });

    expect(screen.getByText("12 rows")).toBeInTheDocument();
    expect(screen.getByText("Student9 Khan")).toBeInTheDocument();
    expect(screen.queryByText("Student10 Khan")).not.toBeInTheDocument();
  });
});
