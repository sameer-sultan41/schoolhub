import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { mocked } from "@/test-fixtures/list-screen";
import { renderWithProviders } from "@/test-utils";

import { ReportExportButtons } from "../report-export-buttons";

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ servicesMock: (domains: Record<string, string[]>) => unknown }>(
      "@/test-fixtures/services-mock",
    )
    .servicesMock({ jobs: ["fetchJob", "fetchFileDownloadUrl"] }),
);

const fetchJob = mocked(Services.jobs.fetchJob);
const fetchFileDownloadUrl = mocked(Services.jobs.fetchFileDownloadUrl);

const JOB_ID = "77777777-dddd-4eee-8fff-000000000001";
const FILE_ID = "88888888-dddd-4eee-8fff-000000000001";

describe("ReportExportButtons", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("starts the format picked, polls its job and downloads the file", async () => {
    const start = jest.fn().mockResolvedValue({ jobId: JOB_ID });
    const filenameFor = jest.fn((format: string) => `report.${format}`);
    fetchJob.mockResolvedValue({
      id: JOB_ID,
      job_type: "some.report-export",
      status: "succeeded",
      progress: 100,
      result: { result_file_id: FILE_ID },
      error: null,
    });
    fetchFileDownloadUrl.mockResolvedValue("https://storage.test/report.xlsx");
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderWithProviders(
      <ReportExportButtons module="some-reports" start={start} filenameFor={filenameFor} />,
    );
    const user = userEvent.setup();

    expect(screen.getByRole("group", { name: "Export the report" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Export XLSX" }));

    expect(start).toHaveBeenCalledWith("xlsx");
    await waitFor(() => {
      expect(fetchFileDownloadUrl).toHaveBeenCalledWith(FILE_ID);
    });
    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalled();
    });
    expect(filenameFor).toHaveBeenCalledWith("xlsx");
    clickSpy.mockRestore();
  });

  it("disables every format with the reason as its title", () => {
    const start = jest.fn();
    renderWithProviders(
      <ReportExportButtons
        module="some-reports"
        start={start}
        filenameFor={(format) => `report.${format}`}
        disabledReason="No export for you."
      />,
    );

    for (const name of ["Export CSV", "Export XLSX", "Export PDF"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled();
      expect(button.parentElement).toHaveAttribute("title", "No export for you.");
    }
    expect(start).not.toHaveBeenCalled();
  });
});
