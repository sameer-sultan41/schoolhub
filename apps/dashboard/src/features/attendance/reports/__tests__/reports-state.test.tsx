import { screen, waitFor } from "@testing-library/react";

import {
  defaulterRow,
  JOB_ID,
  summaryRow,
} from "@/services/modules/attendance-reports/__tests__/attendance-reports-fixtures";

import {
  asUser,
  CLASS_ID,
  CLASS_NAME,
  EXPORT,
  exportReport,
  fetchJob,
  lastRun,
  PERIOD_ID,
  pick,
  renderReports,
  reportJob,
  runReport,
  SECTION_ID,
  SECTION_NAME,
  stubReportsServices,
  urlParam,
} from "./reports-test-support";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ reportsServicesMock: () => unknown }>("./reports-services-mock")
    .reportsServicesMock(),
);

/** The daily register for 2026-10-23 in section A, from a shared link. */
const REGISTER_LINK = `/attendance/reports?kind=daily-register&from=2026-10-23&class=${CLASS_ID}&section=${SECTION_ID}`;
const STALE_HINT =
  "The options changed. Run the report to update it; the table below and its exports still show the last run.";

const runButton = () => screen.getByRole("button", { name: "Run report" });
const periodPicker = () => screen.queryByRole("combobox", { name: "Period" });

describe("Reports: the mode, links and a changed form", () => {
  beforeEach(() => {
    stubReportsServices();
    runReport.mockResolvedValue({ kind: "daily-register", rows: [], attendanceMode: "daily" });
  });

  it("offers the period picker before any report has said how the school marks", async () => {
    const user = await renderReports();

    await pick(user, "Report", "Daily register");
    await pick(user, "Class", CLASS_NAME);
    await pick(user, "Section", SECTION_NAME);

    expect(await screen.findByRole("combobox", { name: "Period" })).toBeInTheDocument();
    expect(runReport).not.toHaveBeenCalled();
  });

  it("hides the picker and drops a period once a report answers in daily mode", async () => {
    stubReportsServices(`${REGISTER_LINK}&period=${PERIOD_ID}`);
    const user = await renderReports();

    await waitFor(() => {
      expect(lastRun()).toMatchObject({ kind: "daily-register", periodId: PERIOD_ID });
    });
    await waitFor(() => {
      expect(urlParam("period")).toBeNull();
    });
    expect(periodPicker()).not.toBeInTheDocument();

    await user.click(runButton());

    await waitFor(() => {
      expect(runReport).toHaveBeenCalledTimes(2);
    });
    expect(lastRun()).toMatchObject({ kind: "daily-register", periodId: undefined });
  });

  it("keeps the picker when the report answers in period mode", async () => {
    stubReportsServices(REGISTER_LINK);
    runReport.mockResolvedValue({ kind: "daily-register", rows: [], attendanceMode: "period" });
    await renderReports();

    expect(await screen.findByText("0 rows")).toBeInTheDocument();
    expect(await screen.findByRole("combobox", { name: "Period" })).toBeInTheDocument();
  });

  it.each([
    ["period", true],
    ["daily", false],
  ] as const)("reads the mode from a large report's job too (%s)", async (mode, offered) => {
    stubReportsServices(REGISTER_LINK);
    runReport.mockResolvedValue({ jobId: JOB_ID });
    fetchJob.mockResolvedValue(
      reportJob("succeeded", {
        result: { result_file_id: "file-1", rows: 1200, format: "csv", attendance_mode: mode },
      }),
    );
    await renderReports();

    expect(await screen.findByRole("button", { name: "Download CSV" })).toBeInTheDocument();
    await waitFor(() => {
      expect(periodPicker() !== null).toBe(offered);
    });
  });

  it("runs a Student summary link on arrival", async () => {
    stubReportsServices("/attendance/reports?kind=student-summary&from=2026-10-01&to=2026-10-31");
    runReport.mockResolvedValue({
      kind: "student-summary",
      rows: [summaryRow()],
      attendanceMode: "daily",
    });
    await renderReports();

    await waitFor(() => {
      expect(lastRun()).toEqual({
        kind: "student-summary",
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        sectionId: undefined,
        periodId: undefined,
        threshold: undefined,
      });
    });
    expect(
      await screen.findByRole("table", { name: "Student summary report" }),
    ).toBeInTheDocument();
  });

  it("writes the default report's kind on Run, so a copied link names it", async () => {
    const user = await renderReports();

    expect(urlParam("kind")).toBeNull();
    await user.click(runButton());

    expect(urlParam("kind")).toBe("student-summary");
    await waitFor(() => {
      expect(lastRun()).toMatchObject({ kind: "student-summary" });
    });
  });

  it("says when the form no longer matches the report, and exports the report shown", async () => {
    stubReportsServices(
      "/attendance/reports?kind=defaulters&from=2026-10-01&to=2026-10-31&threshold=90",
    );
    asUser(EXPORT);
    runReport.mockResolvedValue({
      kind: "defaulters",
      rows: [defaulterRow()],
      attendanceMode: "daily",
    });
    exportReport.mockResolvedValue({ jobId: JOB_ID });
    fetchJob.mockReturnValue(new Promise(() => {}));
    const user = await renderReports();

    expect(await screen.findByRole("table", { name: "Defaulters report" })).toBeInTheDocument();
    expect(screen.queryByText(STALE_HINT)).not.toBeInTheDocument();

    const threshold = screen.getByLabelText("Below (%)");
    await user.clear(threshold);
    await user.type(threshold, "80");

    expect(await screen.findByText(STALE_HINT)).toBeInTheDocument();
    const exportCsv = screen.getByRole("button", { name: "Export CSV" });
    await waitFor(() => {
      expect(exportCsv).toBeEnabled();
    });
    await user.click(exportCsv);
    await waitFor(() => {
      expect(exportReport).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "defaulters", threshold: "90" }),
        "csv",
      );
    });

    await user.click(runButton());
    await waitFor(() => {
      expect(lastRun()).toMatchObject({ threshold: "80" });
    });
    await waitFor(() => {
      expect(screen.queryByText(STALE_HINT)).not.toBeInTheDocument();
    });
  });
});
