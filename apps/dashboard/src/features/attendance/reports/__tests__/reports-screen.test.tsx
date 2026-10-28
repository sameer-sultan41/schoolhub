import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";

import { todayIsoDate } from "@/lib/helpers";
import {
  defaulterRow,
  FILE_ID,
  JOB_ID,
} from "@/services/modules/attendance-reports/__tests__/attendance-reports-fixtures";
import { defaultReportRange } from "@/services/modules/attendance-reports/attendance-reports-helper";

import {
  asUser,
  CLASS_ID,
  EXPORT,
  exportReport,
  fetchFileDownloadUrl,
  fetchJob,
  lastRun,
  PERIOD_ID,
  pick,
  renderReports,
  reportJob,
  rowOf,
  runReport,
  SECTION_ID,
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

const DEFAULTERS_LINK =
  "/attendance/reports?kind=defaulters&from=2026-10-01&to=2026-10-31&threshold=90";
const DEFAULTERS_QUERY = {
  kind: "defaulters",
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  sectionId: undefined,
  periodId: undefined,
  threshold: "90",
};

const defaultersAnswer = {
  kind: "defaulters" as const,
  rows: [defaulterRow()],
  attendanceMode: "daily" as const,
};

const runButton = () => screen.getByRole("button", { name: "Run report" });
const threshold = () => screen.getByLabelText("Below (%)");

describe("Reports", () => {
  beforeEach(() => {
    stubReportsServices();
    runReport.mockResolvedValue(defaultersAnswer);
  });

  it("waits for Run report on a bare visit", async () => {
    await renderReports();

    expect(screen.getByText("Pick a report and run it")).toBeInTheDocument();
    expect(runReport).not.toHaveBeenCalled();
  });

  it("runs a defaulters report at the threshold typed, keeping the form in the URL", async () => {
    const user = await renderReports();

    await pick(user, "Report", "Defaulters");
    expect(threshold()).toHaveValue(75);
    await user.clear(threshold());
    await user.type(threshold(), "90");
    await user.click(runButton());

    expect(urlParam("kind")).toBe("defaulters");
    expect(urlParam("threshold")).toBe("90");
    const range = defaultReportRange(todayIsoDate());
    await waitFor(() => {
      expect(lastRun()).toEqual({
        ...DEFAULTERS_QUERY,
        startDate: range.from,
        endDate: range.to,
      });
    });
    expect(await screen.findByRole("table", { name: "Defaulters report" })).toBeInTheDocument();
    expect(rowOf("Ayesha Khan").getByText("40.0%")).toBeInTheDocument();
  });

  it("refuses to run a threshold the API would refuse, and says why", async () => {
    const user = await renderReports();

    await pick(user, "Report", "Defaulters");
    await user.clear(threshold());
    await user.type(threshold(), "100.5");

    expect(runButton()).toBeDisabled();
    expect(
      screen.getByText("Enter a percentage from 0 to 100, with at most one decimal place."),
    ).toBeInTheDocument();
    expect(threshold()).toHaveAttribute("aria-invalid", "true");
  });

  it("runs the report a shared link names on arrival", async () => {
    setUrlAndStub(DEFAULTERS_LINK);
    await renderReports();

    await waitFor(() => {
      expect(lastRun()).toEqual(DEFAULTERS_QUERY);
    });
    expect(await screen.findByText("1 row")).toBeInTheDocument();
  });

  it("sends the daily register its one date, section and one period's rows", async () => {
    setUrlAndStub(
      `/attendance/reports?kind=daily-register&from=2026-10-23&class=${CLASS_ID}&section=${SECTION_ID}`,
    );
    // Period mode: the one-period view is offered.
    runReport.mockResolvedValue({ kind: "daily-register", rows: [], attendanceMode: "period" });
    const user = await renderReports();

    await waitFor(() => {
      expect(lastRun()).toEqual({
        kind: "daily-register",
        startDate: "2026-10-23",
        endDate: undefined,
        sectionId: SECTION_ID,
        periodId: undefined,
        threshold: undefined,
      });
    });
    // Lesson periods only: the break is not offered.
    await user.click(await screen.findByRole("combobox", { name: "Period" }));
    expect(screen.queryByRole("option", { name: /Recess/ })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("option", { name: "Period 1 (08:00–08:45)" }));
    await user.click(runButton());

    expect(urlParam("period")).toBe(PERIOD_ID);
    await waitFor(() => {
      expect(lastRun()).toMatchObject({ kind: "daily-register", periodId: PERIOD_ID });
    });
  });

  it("polls a report too large to show, then offers its file", async () => {
    setUrlAndStub(DEFAULTERS_LINK);
    runReport.mockResolvedValue({ jobId: JOB_ID });
    fetchJob.mockResolvedValue(reportJob("succeeded"));
    fetchFileDownloadUrl.mockResolvedValue("https://storage.test/attendance-defaulters.csv");
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const user = await renderReports();

    expect(await screen.findByText("This report is being built as a file")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchJob).toHaveBeenCalledWith(JOB_ID);
    });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Download CSV" }));

    await waitFor(() => {
      expect(fetchFileDownloadUrl).toHaveBeenCalledWith(FILE_ID);
    });
    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalled();
    });
    clickSpy.mockRestore();
  });

  it("says so when the large report's job fails", async () => {
    setUrlAndStub(DEFAULTERS_LINK);
    runReport.mockResolvedValue({ jobId: JOB_ID });
    fetchJob.mockResolvedValue(reportJob("failed", { error: "Unknown report kind 'x'" }));
    await renderReports();

    expect(await screen.findByText("Unknown report kind 'x'")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download CSV" })).not.toBeInTheDocument();
  });

  it("exports the report on screen in the format picked", async () => {
    setUrlAndStub(DEFAULTERS_LINK);
    asUser(EXPORT);
    exportReport.mockResolvedValue({ jobId: JOB_ID });
    fetchJob.mockResolvedValue(reportJob("succeeded"));
    fetchFileDownloadUrl.mockResolvedValue("https://storage.test/attendance-defaulters.xlsx");
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const user = await renderReports();

    const exportXlsx = await screen.findByRole("button", { name: "Export XLSX" });
    await waitFor(() => {
      expect(exportXlsx).toBeEnabled();
    });
    await user.click(exportXlsx);

    await waitFor(() => {
      expect(exportReport).toHaveBeenCalledWith(DEFAULTERS_QUERY, "xlsx");
    });
    await waitFor(() => {
      expect(fetchFileDownloadUrl).toHaveBeenCalledWith(FILE_ID);
    });
    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalled();
    });
    clickSpy.mockRestore();
  });

  it("disables export without report.export, and says why", async () => {
    setUrlAndStub(DEFAULTERS_LINK);
    await renderReports();

    for (const name of ["Export CSV", "Export XLSX", "Export PDF"]) {
      const button = await screen.findByRole("button", { name });
      expect(button).toBeDisabled();
      expect(button.parentElement).toHaveAttribute(
        "title",
        "You don't have permission to export reports.",
      );
    }
    expect(exportReport).not.toHaveBeenCalled();
  });

  it("shows the server's refusal, and Try again runs the report again", async () => {
    setUrlAndStub(DEFAULTERS_LINK);
    const refusal = "The range ends before it starts.";
    runReport.mockRejectedValueOnce(
      new ApiError({
        code: "domain_rule_violation",
        message: refusal,
        status: 422,
        url: "/reports/attendance-summary",
        details: [{ field: "end_date", issue: refusal }],
      }),
    );
    const user = await renderReports();

    expect(await screen.findByText(refusal)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("table", { name: "Defaulters report" })).toBeInTheDocument();
    expect(runReport).toHaveBeenCalledTimes(2);
  });

  it("runs the report again when the server refuses to report on its job", async () => {
    setUrlAndStub(DEFAULTERS_LINK);
    runReport.mockResolvedValue({ jobId: JOB_ID });
    const notFound = "Not found.";
    fetchJob.mockRejectedValue(
      new ApiError({ code: "not_found", message: notFound, status: 404, url: `/jobs/${JOB_ID}` }),
    );
    const user = await renderReports();

    await user.click(await screen.findByRole("button", { name: "Run the report again" }));

    expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(runReport).toHaveBeenCalledTimes(2);
    });
  });
});

/** Starts from `url` with the default stubs, before the screen mounts. */
function setUrlAndStub(url: string) {
  stubReportsServices(url);
  runReport.mockResolvedValue(defaultersAnswer);
}
