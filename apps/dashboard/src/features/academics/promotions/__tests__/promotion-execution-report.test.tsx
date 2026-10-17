import { screen } from "@testing-library/react";

import type { PromotionExecutionReport } from "@/services";
import {
  promotionDecision,
  studentUuid,
} from "@/services/modules/promotions/__tests__/promotions-fixtures";
import { renderWithProviders } from "@/test-utils";

import { PromotionExecutionReportCard } from "../promotion-execution-report";

const DECISIONS = [
  promotionDecision({ student_id: studentUuid(1), student_name: "Ayesha Khan" }),
  promotionDecision({
    student_id: studentUuid(2),
    student_name: "Bilal Ahmed",
    admission_number: "ADM-0002",
  }),
  promotionDecision({
    student_id: studentUuid(3),
    student_name: "Zainab Qureshi",
    admission_number: "ADM-0003",
  }),
  promotionDecision({
    student_id: studentUuid(4),
    student_name: "Usman Ali",
    admission_number: "ADM-0004",
  }),
];

const EMPTY_REPORT: PromotionExecutionReport = {
  enrolled: [],
  graduated: [],
  skipped: [],
  failed: [],
};

/** One student of each outcome: Ayesha enrolled, Usman graduated, Zainab skipped, Bilal failed. */
const REPORT: PromotionExecutionReport = {
  enrolled: [{ student_id: studentUuid(1) }],
  graduated: [{ student_id: studentUuid(4) }],
  skipped: [{ student_id: studentUuid(3), reason: "already executed" }],
  failed: [
    {
      student_id: studentUuid(2),
      error: "Assign a target section before executing this batch.",
    },
  ],
};

function renderReport(report: PromotionExecutionReport) {
  return renderWithProviders(
    <PromotionExecutionReportCard report={report} decisions={DECISIONS} />,
  );
}

describe("PromotionExecutionReportCard", () => {
  it("counts each outcome", () => {
    renderReport(REPORT);

    expect(screen.getByRole("heading", { name: "Execution report" })).toBeInTheDocument();
    expect(screen.getByText("Enrolled in the next session: 1")).toBeInTheDocument();
    expect(screen.getByText("Graduated: 1")).toBeInTheDocument();
    expect(screen.getByText("Skipped: 1")).toBeInTheDocument();
    expect(screen.getByText("Failed: 1")).toBeInTheDocument();
  });

  it("lists a failed student by name and admission number, with the error", () => {
    renderReport(REPORT);

    expect(
      screen.getByText(
        "Bilal Ahmed (ADM-0002): Assign a target section before executing this batch.",
      ),
    ).toBeInTheDocument();
    // By name, never by the id the report carries.
    expect(screen.queryByText(new RegExp(studentUuid(2)))).not.toBeInTheDocument();
  });

  it("lists a skipped student by name, with the reason", () => {
    renderReport(REPORT);

    expect(screen.getByText("Zainab Qureshi (ADM-0003): already executed")).toBeInTheDocument();
  });

  it("does not list the students who moved on: only the counts say they did", () => {
    renderReport(REPORT);

    expect(screen.queryByText(/Ayesha Khan/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Usman Ali/)).not.toBeInTheDocument();
  });

  it("falls back to the id for a student the batch no longer lists", () => {
    const stranger = studentUuid(99);
    renderReport({ ...EMPTY_REPORT, failed: [{ student_id: stranger, error: "Boom." }] });

    expect(screen.getByText(`${stranger}: Boom.`)).toBeInTheDocument();
  });

  it("shows every count, zero included, and lists no student when none failed or skipped", () => {
    renderReport(EMPTY_REPORT);

    expect(screen.getByText("Enrolled in the next session: 0")).toBeInTheDocument();
    expect(screen.getByText("Failed: 0")).toBeInTheDocument();
    // The counts are the one list.
    expect(screen.getAllByRole("list")).toHaveLength(1);
  });
});
