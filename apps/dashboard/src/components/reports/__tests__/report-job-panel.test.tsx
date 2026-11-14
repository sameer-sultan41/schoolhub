import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import type { BackgroundJobRecord, JobStatus } from "@/services/modules/jobs/jobs-service";
import { mocked } from "@/test-fixtures/list-screen";
import { renderWithProviders } from "@/test-utils";

import { ReportJobPanel } from "../report-job-panel";

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

const MODULE = "some-reports";
const JOB_ID = "77777777-cccc-4ddd-8eee-000000000001";
const FILE_ID = "88888888-cccc-4ddd-8eee-000000000001";
const FILENAME = "some-report.csv";

function reportJob(status: JobStatus, overrides: Partial<BackgroundJobRecord> = {}) {
  return {
    id: JOB_ID,
    job_type: "some.report-export",
    status,
    progress: status === "succeeded" ? 100 : 40,
    result: status === "succeeded" ? { result_file_id: FILE_ID, rows: 1200, format: "csv" } : null,
    error: null,
    ...overrides,
  } satisfies BackgroundJobRecord;
}

function renderPanel(props: { onSucceeded?: jest.Mock; onRestart?: jest.Mock } = {}) {
  renderWithProviders(
    <ReportJobPanel
      module={MODULE}
      jobId={JOB_ID}
      filename={FILENAME}
      onSucceeded={props.onSucceeded}
      onRestart={props.onRestart ?? jest.fn()}
    />,
  );
  return userEvent.setup();
}

describe("ReportJobPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("polls the job, then downloads its file and tells the screen the result", async () => {
    fetchJob.mockResolvedValue(reportJob("succeeded"));
    fetchFileDownloadUrl.mockResolvedValue("https://storage.test/some-report.csv");
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const onSucceeded = jest.fn();
    const user = renderPanel({ onSucceeded });

    expect(screen.getByText("This report is being built as a file")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Download CSV" }));

    expect(fetchJob).toHaveBeenCalledWith(JOB_ID);
    await waitFor(() => {
      expect(fetchFileDownloadUrl).toHaveBeenCalledWith(FILE_ID);
    });
    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalled();
    });
    expect(onSucceeded).toHaveBeenCalledWith(reportJob("succeeded").result);
    clickSpy.mockRestore();
  });

  it("shows a running job's progress", async () => {
    fetchJob.mockResolvedValue(reportJob("running"));
    renderPanel();

    expect(await screen.findByText("Building the file — 40%")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download CSV" })).not.toBeInTheDocument();
  });

  it("says so when the job fails, with the job's own reason", async () => {
    fetchJob.mockResolvedValue(reportJob("failed", { error: "Unknown report kind 'x'" }));
    const onSucceeded = jest.fn();
    renderPanel({ onSucceeded });

    expect(await screen.findByText("Unknown report kind 'x'")).toBeInTheDocument();
    expect(onSucceeded).not.toHaveBeenCalled();
  });

  it("offers to run the report again when the server refuses to report on its job", async () => {
    fetchJob.mockRejectedValue(
      new ApiError({
        code: "not_found",
        message: "Not found.",
        status: 404,
        url: `/jobs/${JOB_ID}`,
      }),
    );
    const onRestart = jest.fn();
    const user = renderPanel({ onRestart });

    await user.click(await screen.findByRole("button", { name: "Run the report again" }));

    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
  });
});
